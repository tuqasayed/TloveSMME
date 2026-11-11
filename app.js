import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js";
import { getAuth, signInWithEmailAndPassword, signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";
import { getFirestore, collection, doc, getDoc, getDocs, query, orderBy, onSnapshot, addDoc, setDoc, updateDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";
import { getMessaging, getToken, isSupported } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-messaging.js";
import { firebaseConfig } from "./firebase-config.js";

const app=initializeApp(firebaseConfig), auth=getAuth(app), db=getFirestore(app);
const CLOUDINARY_CLOUD_NAME="svigkr4e", CLOUDINARY_UPLOAD_PRESET="chat_upload";
const NOTIFICATION_WORKER_URL="https://bubble-chat-notifications.mainmohammedy.workers.dev";
const VAPID_PUBLIC_KEY="BNntJ7Pft1mjX9eAemavXWmOmjrZj9I-VDyV-zsqFm-otZV0WKadTAcgjUKJOrexkCzmhC2Lmy7tB2tqcQ5PXuI";
const $=id=>document.getElementById(id); let currentUser=null,currentProfile=null,activeChat=null,stopMessages=null,chatOpenVersion=0,replyTarget=null,editingId=null,selectedAvatarFile=null;
const userProfiles=new Map();
const USERNAMES=["Samaa","Tuqa","Menna"], GROUP_ID="bubble-chat-three-friends", GROUP={id:GROUP_ID,kind:"group",username:"الجروب",displayName:"We's Core ᥫ᭡",participants:[]};
const STICKERS = [
  { src: "https://res.cloudinary.com/svigkr4e/image/upload/1.jpg", label: "ستيكر 1" },
  { src: "https://res.cloudinary.com/svigkr4e/image/upload/2.jpg", label: "ستيكر 2" },
  { src: "https://res.cloudinary.com/svigkr4e/image/upload/3.jpg", label: "ستيكر 3" },
  { src: "https://res.cloudinary.com/svigkr4e/image/upload/4.jpg", label: "ستيكر 4" },
  { src: "https://res.cloudinary.com/svigkr4e/image/upload/5.jpg", label: "ستيكر 5" },
  { src: "https://res.cloudinary.com/svigkr4e/image/upload/6.jpg", label: "ستيكر 6" },
  { src: "https://res.cloudinary.com/svigkr4e/image/upload/7.jpg", label: "ستيكر 7" },
  { src: "https://res.cloudinary.com/svigkr4e/image/upload/8.jpg", label: "ستيكر 8" },
  { src: "https://res.cloudinary.com/svigkr4e/image/upload/9.gif", label: "ستيكر 9" },
  { src: "https://res.cloudinary.com/svigkr4e/image/upload/10.jpg", label: "ستيكر 10" },
  { src: "https://res.cloudinary.com/svigkr4e/image/upload/11.jpg", label: "ستيكر 11" }
];
const $safe=s=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const emailFor=name=>`${name.toLowerCase()}@bubblechat.app`;
function threadId(a,b){return [a,b].sort().join("_")}
function isGroup(){return activeChat?.kind==="group"}
function colorOf(p){return p?.color||({Samaa:"#55cbd5",Tuqa:"#ed8fbd",Menna:"#a78be8"}[p?.username]||"#a78be8")}
function applyMyTheme(){if(currentProfile)document.documentElement.style.setProperty("--theme-color",colorOf(currentProfile))}
function avatarMarkup(p,size=""){const color=colorOf(p),photo=p?.photoURL;return `<div class="avatar ${size}" style="--user-color:${color}">${photo?`<img src="${$safe(photo)}" alt="">`:$safe((p?.displayName||p?.username||"♡").slice(0,1))}</div>`}
function renderChatAvatar(target){
  const avatar=$("chatAvatar");
  if(!avatar)return;
  if(target.kind==="group"){
    avatar.className="group-avatar large";
    avatar.removeAttribute("style");
    avatar.innerHTML='♡<small>3</small>';
    return;
  }
  avatar.className="avatar";
  avatar.style.setProperty("--user-color",colorOf(target));
  const photo=target.photoURL;
  avatar.innerHTML=photo?`<img src="${$safe(photo)}" alt="">`:$safe((target.displayName||target.username||"♡").slice(0,1));
}
function toast(t){const el=$("toast");el.textContent=t;el.classList.remove("hidden");clearTimeout(toast.timer);toast.timer=setTimeout(()=>el.classList.add("hidden"),2600)}
function timeOf(ts){return ts?.toDate?ts.toDate().toLocaleTimeString("ar-EG",{hour:"2-digit",minute:"2-digit"}):"الآن"}
function showLogin(msg=""){$("loginView").classList.remove("hidden");$("chatView").classList.add("hidden");$("loginError").textContent=msg}
function showChat(){$("loginView").classList.add("hidden");$("chatView").classList.remove("hidden")}

async function enablePushNotifications(){
  if(!currentUser)throw new Error("سجّلي الدخول أولًا");
  if(!("serviceWorker" in navigator) || !("Notification" in window))throw new Error("المتصفح لا يدعم إشعارات الويب");
  if(!(await isSupported()))throw new Error("إشعارات Firebase غير مدعومة في هذا المتصفح");
  const permission=await Notification.requestPermission();
  if(permission!=="granted")throw new Error("لم يتم السماح بالإشعارات");
  const registration=await navigator.serviceWorker.register("./firebase-messaging-sw.js");
  const messaging=getMessaging(app);
  const token=await getToken(messaging,{vapidKey:VAPID_PUBLIC_KEY,serviceWorkerRegistration:registration});
  if(!token)throw new Error("تعذر إنشاء رمز الإشعارات");
  await setDoc(doc(db,"users",currentUser.uid,"fcmTokens",token),{
    token, platform:"web-android", updatedAt:serverTimestamp()
  });
  toast("تم تفعيل الإشعارات على هذا الجهاز ♡");
}
async function notifyRecipients(threadIdValue,messageIdValue){
  try{
    const idToken=await currentUser.getIdToken();
    const response=await fetch(NOTIFICATION_WORKER_URL,{
      method:"POST",
      headers:{"Content-Type":"application/json","Authorization":`Bearer ${idToken}`},
      body:JSON.stringify({threadId:threadIdValue,messageId:messageIdValue})
    });
    if(!response.ok)console.warn("Notification delivery failed:",await response.text());
  }catch(error){console.warn("Could not call notification worker:",error)}
}
$("enableNotificationsBtn").addEventListener("click",async()=>{
  const button=$("enableNotificationsBtn");
  button.disabled=true;
  try{await enablePushNotifications()}
  catch(error){console.error(error);toast(error.message||"تعذر تفعيل الإشعارات")}
  finally{button.disabled=false}
});
$("loginForm").addEventListener("submit",async e=>{e.preventDefault();const name=$("username").value.trim();if(!USERNAMES.some(n=>n.toLowerCase()===name.toLowerCase()))return $("loginError").textContent="اسم المستخدم غير مسموح به.";try{await signInWithEmailAndPassword(auth,emailFor(name),$("password").value)}catch(err){console.error(err);$("loginError").textContent="اسم المستخدم أو كلمة المرور غير صحيحة."}});
$("logoutBtn").onclick=()=>signOut(auth);
onAuthStateChanged(auth,async user=>{chatOpenVersion++;if(stopMessages){stopMessages();stopMessages=null}activeChat=null;if(!user){currentUser=currentProfile=null;showLogin();return}currentUser=user;try{const s=await getDoc(doc(db,"users",user.uid));if(!s.exists()){await signOut(auth);return showLogin("الحساب غير مُجهّز في Firestore.")}currentProfile={id:user.uid,...s.data()};currentProfile.displayName ||= currentProfile.username;renderMe();showChat();await loadContacts()}catch(e){console.error(e);showLogin("تعذر تحميل الحساب. راجع إعدادات Firebase.")}});
function renderMe(){applyMyTheme();$("myName").textContent=currentProfile.displayName||currentProfile.username;const a=$("myAvatar");a.style.setProperty("--user-color",colorOf(currentProfile));a.innerHTML=currentProfile.photoURL?`<img src="${$safe(currentProfile.photoURL)}" alt="">`:$safe((currentProfile.displayName||currentProfile.username).slice(0,1));const p=$("profileAvatarPreview");p.style.setProperty("--user-color",colorOf(currentProfile));p.innerHTML=currentProfile.photoURL?`<img src="${$safe(currentProfile.photoURL)}" alt="">`:$safe((currentProfile.displayName||currentProfile.username).slice(0,1))}
async function loadContacts(){const s=await getDocs(collection(db,"users"));const users=s.docs.map(d=>({id:d.id,...d.data()}));userProfiles.clear();users.forEach(u=>userProfiles.set(u.id,u));if(currentProfile)userProfiles.set(currentUser.uid,currentProfile);GROUP.participants=users.map(u=>u.id);const others=users.filter(u=>u.id!==currentUser.uid);const groupBtn=contactButton(GROUP,true);contactsElReplace(groupBtn);others.forEach(p=>$("contacts").appendChild(contactButton(p,false)))}
function contactsElReplace(groupBtn){$("contacts").innerHTML="";$("contacts").appendChild(groupBtn)}
function contactButton(p,group){const b=document.createElement("button");b.className="contact";b.style.setProperty("--contact-color",group?"#a78be8":colorOf(p));b.innerHTML=`${group?'<div class="group-avatar">♡<small>3</small></div>':avatarMarkup(p)}<div><strong style="color:${group?'#a78be8':colorOf(p)}">${$safe(group?"We's Core ᥫ᭡":p.displayName||p.username)}</strong><small>${group?"التلاتة مع بعض ✨":"افتحوا حكاية جديدة 💕"}</small></div>`;b.onclick=()=>openChat(p);return b}
async function openChat(target){
  const openVersion=++chatOpenVersion;
  activeChat=target;
  replyTarget=null;
  editingId=null;
  $("replyPreview").classList.add("hidden");
  $("stickerTray").classList.add("hidden");
  document.querySelectorAll(".contact").forEach(x=>x.classList.remove("selected"));
  [...$("contacts").children].find(x=>x.querySelector("strong")?.textContent===(target.kind==="group"?"We's Core ᥫ᭡":target.displayName||target.username))?.classList.add("selected");
  $("emptyState").classList.add("hidden");
  $("activeChat").classList.remove("hidden");
  $("chatName").textContent=target.kind==="group"?"We's Core ᥫ᭡":target.displayName||target.username;
  $("chatHeader").style.setProperty("--chat-color",target.kind==="group"?"#a78be8":colorOf(target));
  $("chatSubtitle").textContent=target.kind==="group"?"Samaa · Tuqa · Menna":"BSFE";
  renderChatAvatar(target);
  $("pinnedBar").classList.add("hidden");
  if(stopMessages){
    stopMessages();
    stopMessages=null;
  }

  const id=target.kind==="group"?GROUP_ID:threadId(currentUser.uid,target.id);
  const ref=doc(db,"threads",id);

  try{
    const snap=await getDoc(ref);
    if(openVersion!==chatOpenVersion)return;

    if(!snap.exists()){
      await setDoc(ref,{
        kind:target.kind||"direct",
        participants:(target.kind==="group"?GROUP.participants:[currentUser.uid,target.id]).sort(),
        participantNames:target.kind==="group"?USERNAMES:[currentProfile.username,target.username],
        createdAt:serverTimestamp(),
        updatedAt:serverTimestamp()
      });
      if(openVersion!==chatOpenVersion)return;
    }

    const q=query(collection(db,"threads",id,"messages"),orderBy("createdAt","asc"));
    const unsubscribe=onSnapshot(q,s=>{
      if(openVersion!==chatOpenVersion)return;
      if(!activeChat)return;
      const currentId=activeChat.kind==="group"?GROUP_ID:threadId(currentUser.uid,activeChat.id);
      if(currentId!==id)return;
      renderMessages(s.docs);
    },e=>{
      if(openVersion!==chatOpenVersion)return;
      console.error("Messages listener failed:",e);
      if(stopMessages===unsubscribe)stopMessages=null;
      toast("في مشكلة في تحميل الرسائل");
    });
    if(openVersion===chatOpenVersion)stopMessages=unsubscribe;
    else unsubscribe();
  }catch(err){
    if(openVersion!==chatOpenVersion)return;
    console.error("Could not open chat:",err);
    toast("تعذر فتح المحادثة. راجع الاتصال وقواعد Firestore");
  }
}
function activeThreadId(){return isGroup()?GROUP_ID:threadId(currentUser.uid,activeChat.id)}
function renderMessages(docs){const box=$("messages");box.innerHTML="";let pinned=[];docs.forEach(d=>{const m={id:d.id,...d.data()};if(m.pinned)pinned.push(m);box.appendChild(messageNode(m))});if(pinned.length){$("pinnedBar").classList.remove("hidden");$("pinnedBar").textContent=`📌 مثبتة: ${pinned.map(m=>(m.text||"ملصق").slice(0,45)).join(" · ")}`}else $("pinnedBar").classList.add("hidden");box.scrollTop=box.scrollHeight}
function messageNode(m){
  const mine=m.senderId===currentUser.uid,el=document.createElement("article");
  el.className=`message ${mine?"mine":"theirs"}`;
  const sender=userProfiles.get(m.senderId)||{};
  const senderPhoto=m.senderPhotoURL||sender.photoURL||"";
  const senderColor=sender.id?colorOf(sender):(m.senderColor||colorOf(sender));
  el.style.setProperty("--sender-color",senderColor);
  const senderInitial=(m.senderName||sender.displayName||sender.username||"♡").slice(0,1);
  const avatar=document.createElement("div");
  avatar.className="avatar message-avatar";
  avatar.style.setProperty("--user-color",senderColor);
  avatar.innerHTML=senderPhoto?`<img src="${$safe(senderPhoto)}" alt="">`:$safe(senderInitial);

  const reply=m.replyTo?`<div class="reply-quote"><b>${$safe(m.replyTo.senderName)}</b><span>${$safe(m.replyTo.text)}</span></div>`:"";
  const content=m.sticker?`<img class="sticker-image" src="${$safe(m.sticker)}" alt="ملصق">`:`<p>${$safe(m.text||"")}</p>`;
  const reactions=Object.entries(m.reactions||{}).filter(([k,v])=>Array.isArray(v)&&v.length).map(([k,v])=>`<button class="reaction-chip" data-emoji="${$safe(k)}">${$safe(k)} ${v.length}</button>`).join("");
  el.innerHTML=`${!mine?`<small class="sender-name" style="color:${$safe(senderColor)}">${$safe(m.senderName||"صديق")}</small>`:""}${m.pinned?'<div class="pin-mark">📌 مثبتة</div>':""}${reply}${content}<div class="message-meta"><time>${timeOf(m.createdAt)}</time>${m.edited?'<span>تم التعديل</span>':""}</div><div class="message-tools"><button data-action="reply" title="رد">↩</button><button data-action="react" title="تفاعل">☺</button><button data-action="pin" title="تثبيت">📌</button>${mine&&!m.sticker?'<button data-action="edit" title="تعديل">✎</button>':""}</div><div class="reaction-list">${reactions}</div><div class="reaction-picker hidden">${["❤️","😂","🥰","👍","✨","😢","🔥","👏"].map(x=>`<button data-react="${x}">${x}</button>`).join("")}</div>`;
  const row=document.createElement("div");
  row.className=`message-row ${mine?"mine":"theirs"}`;
  row.appendChild(avatar);
  row.appendChild(el);
  row.querySelectorAll("[data-action]").forEach(btn=>btn.onclick=()=>handleMessageAction(btn.dataset.action,m,el));
  row.querySelectorAll("[data-react]").forEach(btn=>btn.onclick=()=>reactTo(m,btn.dataset.react));
  row.querySelectorAll(".reaction-chip").forEach(btn=>btn.onclick=()=>reactTo(m,btn.dataset.emoji));
  return row;
}
async function handleMessageAction(action,m,el){if(action==="reply"){replyTarget=m;editingId=null;$("replyText").textContent=`رد على ${m.senderName}: ${(m.text||"ملصق").slice(0,90)}`;$("replyPreview").classList.remove("hidden");$("messageInput").focus()}if(action==="edit"){if(m.senderId!==currentUser.uid)return;editingId=m.id;replyTarget=null;$("messageInput").value=m.text||"";$("messageInput").focus();toast("عدّل الرسالة ثم اضغط إرسال") }if(action==="pin"){await updateDoc(doc(db,"threads",activeThreadId(),"messages",m.id),{pinned:!m.pinned});toast(m.pinned?"تم إلغاء التثبيت":"تم تثبيت الرسالة") }if(action==="react")el.querySelector(".reaction-picker").classList.toggle("hidden")}
async function reactTo(m,emoji){const r=doc(db,"threads",activeThreadId(),"messages",m.id),snap=await getDoc(r),data=snap.data()||{},reactions={...(data.reactions||{})},arr=[...(reactions[emoji]||[])];reactions[emoji]=arr.includes(currentUser.uid)?arr.filter(x=>x!==currentUser.uid):[...arr,currentUser.uid];await updateDoc(r,{reactions});}
$("messageForm").addEventListener("submit",async e=>{e.preventDefault();const input=$("messageInput"),text=input.value.trim();if(!text||!activeChat)return;const tid=activeThreadId();try{if(editingId){await updateDoc(doc(db,"threads",tid,"messages",editingId),{text,edited:true,editedAt:serverTimestamp()});editingId=null}else{const payload={text,senderId:currentUser.uid,senderName:currentProfile.displayName||currentProfile.username,senderColor:colorOf(currentProfile),senderPhotoURL:currentProfile.photoURL||"",createdAt:serverTimestamp()};if(replyTarget)payload.replyTo={id:replyTarget.id,text:replyTarget.text||"ملصق",senderName:replyTarget.senderName||"صديق"};const sent=await addDoc(collection(db,"threads",tid,"messages"),payload);notifyRecipients(tid,sent.id)}input.value="";replyTarget=null;$("replyPreview").classList.add("hidden");await updateDoc(doc(db,"threads",tid),{updatedAt:serverTimestamp()})}catch(err){console.error(err);toast("تعذر حفظ الرسالة. راجع قواعد Firestore")}});
$("cancelReply").onclick=()=>{replyTarget=null;$("replyPreview").classList.add("hidden")};
$("stickerBtn").onclick=()=>{$("stickerTray").classList.toggle("hidden");renderStickerTray()};function renderStickerTray(){const tray=$("stickerTray");tray.innerHTML=STICKERS.length?STICKERS.map((s,i)=>`<button data-sticker="${i}"><img src="${$safe(s.src)}" alt="${$safe(s.label||"ستيكر")}"></button>`).join(""):'<p>مكان الستيكرات بتاعتكم 🫧<br>ضيفوا الصور أو GIF داخل مجلد stickers ثم سجّلوا مساراتها في STICKERS أعلى ملف app.js.</p>';tray.querySelectorAll("[data-sticker]").forEach(b=>b.onclick=async()=>{const sticker=STICKERS[Number(b.dataset.sticker)].src;try{const tid=activeThreadId();const sent=await addDoc(collection(db,"threads",tid,"messages"),{sticker,senderId:currentUser.uid,senderName:currentProfile.displayName||currentProfile.username,senderColor:colorOf(currentProfile),senderPhotoURL:currentProfile.photoURL||"",createdAt:serverTimestamp()});notifyRecipients(tid,sent.id);tray.classList.add("hidden")}catch(e){toast("تعذر إرسال الملصق")}})}
$("pinnedToggle").onclick=()=>{$("pinnedBar").classList.toggle("hidden")};
function setProfileColor(color,name){
  $("profileColor").value=color;
  $("selectedColorDot").style.background=color;
  $("selectedColorDot").style.boxShadow=`0 0 12px ${color}`;
  $("selectedColorName").textContent=name;
  document.querySelectorAll(".neon-color-option").forEach(option=>{
    const active=option.dataset.color===color;
    option.classList.toggle("selected",active);
    option.setAttribute("aria-selected",String(active));
  });
}
function closeColorMenu(){
  $("colorSelectMenu").classList.add("hidden");
  $("colorSelectTrigger").setAttribute("aria-expanded","false");
}
$("colorSelectTrigger").onclick=()=>{
  const opening=$("colorSelectMenu").classList.contains("hidden");
  $("colorSelectMenu").classList.toggle("hidden");
  $("colorSelectTrigger").setAttribute("aria-expanded",String(opening));
};
document.querySelectorAll(".neon-color-option").forEach(option=>option.onclick=()=>{
  setProfileColor(option.dataset.color,option.dataset.name);
  closeColorMenu();
});
document.addEventListener("click",e=>{
  if(!$("neonColorSelect").contains(e.target))closeColorMenu();
});
$("profileBtn").onclick=()=>{
  $("displayNameInput").value=currentProfile.displayName||currentProfile.username;
  const color=colorOf(currentProfile);
  const currentOption=[...document.querySelectorAll(".neon-color-option")].find(o=>o.dataset.color===color);
  setProfileColor(color,currentOption?.dataset.name||"لون مخصص");
  selectedAvatarFile=null;
  $("profileModal").classList.remove("hidden");
};
$("closeProfile").onclick=()=>{$("profileModal").classList.add("hidden");closeColorMenu()};$("avatarFile").onchange=e=>{selectedAvatarFile=e.target.files[0];if(selectedAvatarFile){const url=URL.createObjectURL(selectedAvatarFile);$("profileAvatarPreview").innerHTML=`<img src="${url}" alt="">`}};
async function uploadAvatarToCloudinary(file){
  const formData=new FormData();
  formData.append("file",file);
  formData.append("upload_preset",CLOUDINARY_UPLOAD_PRESET);
  formData.append("folder","chat-assets/avatars");
  const response=await fetch(`https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD_NAME}/image/upload`,{method:"POST",body:formData});
  const result=await response.json();
  if(!response.ok)throw new Error(result?.error?.message||"فشل رفع الصورة إلى Cloudinary");
  if(!result.secure_url)throw new Error("Cloudinary لم يرجع رابط الصورة");
  return result.secure_url;
}
$("profileForm").onsubmit=async e=>{e.preventDefault();const displayName=$("displayNameInput").value.trim();if(!displayName)return;const saveButton=$("profileForm").querySelector('button[type="submit"]');const oldButtonText=saveButton.textContent;saveButton.disabled=true;saveButton.textContent="جاري الحفظ...";$("profileError").textContent="";try{let photoURL=currentProfile.photoURL||"";if(selectedAvatarFile){if(selectedAvatarFile.size>3*1024*1024)throw new Error("حجم الصورة أكبر من 3MB");if(!selectedAvatarFile.type.startsWith("image/"))throw new Error("اختاري ملف صورة صالح");photoURL=await uploadAvatarToCloudinary(selectedAvatarFile)}const patch={displayName,color:$("profileColor").value,photoURL};await updateDoc(doc(db,"users",currentUser.uid),patch);currentProfile={...currentProfile,...patch};userProfiles.set(currentUser.uid,currentProfile);renderMe();await loadContacts();$("profileModal").classList.add("hidden");selectedAvatarFile=null;toast("اتحفظ ملفك الشخصي ♡")}catch(err){console.error(err);$("profileError").textContent=err.message||"تعذر حفظ الملف. تأكدي من إعدادات Cloudinary وقواعد Firestore."}finally{saveButton.disabled=false;saveButton.textContent=oldButtonText}};
const THEME_KEY = "bubble-chat-theme";
function applyTheme(mode){
  const dark = mode === "dark";
  document.body.classList.toggle("dark-mode", dark);
  const toggle = $("themeToggle");
  if(toggle){ toggle.textContent = dark ? "☀️" : "🌙"; toggle.title = dark ? "تفعيل الوضع الفاتح" : "تفعيل الوضع الداكن"; toggle.setAttribute("aria-label", toggle.title); }
  const meta = document.querySelector('meta[name="theme-color"]');
  if(meta) meta.content = dark ? "#11121a" : "#f7f5ff";
}
applyTheme(localStorage.getItem(THEME_KEY) || "light");
$("themeToggle")?.addEventListener("click",()=>{
  const next = document.body.classList.contains("dark-mode") ? "light" : "dark";
  localStorage.setItem(THEME_KEY,next); applyTheme(next);
});
