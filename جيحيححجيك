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
const unreadStops=new Map(), unreadCounts=new Map();
let stopContacts=null,presenceHeartbeat=null,presenceUiTimer=null,contactsInitialized=false;
const PRESENCE_STALE_MS=75000;
const READ_KEY_PREFIX="bubble-chat-read-";
let lastIncomingSoundAt=0;
let audioUnlocked=false;
function unlockChatSounds(){
  if(audioUnlocked)return;
  const sounds=[$("messageSound"),$("receiveSound")].filter(Boolean);
  if(!sounds.length)return;
  // المتصفحات على الموبايل تحتاج تفاعلًا مباشرًا من المستخدم قبل السماح بالصوت.
  sounds.forEach(audio=>{
    const wasMuted=audio.muted;
    audio.muted=true;
    const attempt=audio.play();
    if(attempt&&typeof attempt.then==="function"){
      attempt.then(()=>{audio.pause();audio.currentTime=0;audio.muted=wasMuted;})
        .catch(error=>{audio.muted=wasMuted;console.warn("تعذر تجهيز الصوت:",audio.id,error);});
    }else{audio.pause();audio.currentTime=0;audio.muted=wasMuted;}
  });
  audioUnlocked=true;
}
["pointerdown","touchstart","keydown"].forEach(eventName=>
  document.addEventListener(eventName,unlockChatSounds,{once:true,capture:true,passive:true})
);
function playSound(id){
  const audio=$(id);if(!audio)return;
  try{audio.pause();audio.currentTime=0;const result=audio.play();
    if(result&&typeof result.catch==="function")result.catch(error=>console.warn(`تعذر تشغيل ${id}. تأكد من مسار ملف الصوت والسماح بالصوت في المتصفح:`,error));
  }catch(error){console.warn(`خطأ في تشغيل ${id}:`,error);}
}
function playIncomingSound(){
  // صوت واحد لكل دفعة رسائل، مع تهدئة بسيطة حتى لا تتزاحم الأصوات عند وصول رسائل كثيرة.
  const now=Date.now();
  if(now-lastIncomingSoundAt<700)return;
  lastIncomingSoundAt=now;
  playSound("receiveSound");
}
function readKey(thread){return `${READ_KEY_PREFIX}${currentUser?.uid||"guest"}-${thread}`;}
function setThreadRead(thread,latestTime=Date.now()){localStorage.setItem(readKey(thread),String(latestTime));unreadCounts.set(thread,0);updateUnreadBadge(thread);}
function updateUnreadBadge(thread){
  const button=[...$("contacts").querySelectorAll(".contact")].find(b=>b.dataset.threadId===thread);if(!button)return;
  let badge=button.querySelector(".unread-badge");const count=unreadCounts.get(thread)||0;
  if(count>0){if(!badge){badge=document.createElement("span");badge.className="unread-badge";badge.setAttribute("aria-label","رسائل غير مقروءة");button.appendChild(badge);}badge.textContent=count>99?"99+":String(count);}
  else badge?.remove();
}
function stopUnreadListeners(){unreadStops.forEach(stop=>stop());unreadStops.clear();unreadCounts.clear();}
function watchUnreadThread(thread){
  if(unreadStops.has(thread))return;
  const qUnread=query(collection(db,"threads",thread,"messages"),orderBy("createdAt","asc"));let initialized=false;
  const stop=onSnapshot(qUnread,snapshot=>{
    const docs=snapshot.docs,latest=docs.at(-1)?.data()?.createdAt,latestTime=latest?.toMillis?.()||Date.now(),key=readKey(thread);
    let lastRead=Number(localStorage.getItem(key));
    if(!initialized&&!Number.isFinite(lastRead)){localStorage.setItem(key,String(latestTime));lastRead=latestTime;}
    const isOpen=activeChat&&(activeChat.kind==="group"?GROUP_ID:threadId(currentUser.uid,activeChat.id))===thread;
    if(isOpen)setThreadRead(thread,latestTime);
    else{
      const unread=docs.filter(d=>{const m=d.data(),time=m.createdAt?.toMillis?.()||0;return m.senderId!==currentUser.uid&&time>lastRead;}).length;
      unreadCounts.set(thread,unread);updateUnreadBadge(thread);
    }
    initialized=true;
  },error=>console.warn("Unread listener failed:",error));
  unreadStops.set(thread,stop);
}

const userProfiles=new Map();
const USERNAMES=["Samaa","Tuqa","Menna"], GROUP_ID="bubble-chat-three-friends", GROUP={id:GROUP_ID,kind:"group",username:"الجروب",displayName:"S.T.M 🌷",participants:[]};
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
function avatarMarkup(p,size=""){
  const color=colorOf(p),photo=p?.photoURL,initial=(p?.displayName||p?.username||"♡").slice(0,1);
  return `<div class="avatar ${size}" style="--user-color:${color}">${photo?`<span class="avatar-fallback">${$safe(initial)}</span><img src="${$safe(photo)}" alt="" loading="eager" decoding="async" onerror="this.remove()">`:$safe(initial)}</div>`;
}
function paintAvatar(element,profile){
  if(!element)return;
  const initial=(profile?.displayName||profile?.username||"♡").slice(0,1);
  const photo=profile?.photoURL;
  element.style.setProperty("--user-color",colorOf(profile));
  element.textContent="";
  if(!photo){element.textContent=initial;return;}
  const fallback=document.createElement("span");fallback.className="avatar-fallback";fallback.textContent=initial;element.appendChild(fallback);
  const img=document.createElement("img");img.alt="";img.loading="eager";img.decoding="async";
  img.onerror=()=>{img.remove();};
  img.src=photo;element.appendChild(img);
}
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
  paintAvatar(avatar,target);
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
  const registration = await navigator.serviceWorker.register(
  "/TloveSMME/firebase-messaging-sw.js",
  { scope: "/TloveSMME/" }
);
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
$("logoutBtn").onclick=async()=>{try{await writeMyPresence(false)}catch(e){console.warn("Could not mark offline",e)}stopPresence();await signOut(auth)};
onAuthStateChanged(auth,async user=>{chatOpenVersion++;if(stopMessages){stopMessages();stopMessages=null}stopUnreadListeners();if(stopContacts){stopContacts();stopContacts=null}stopPresence();contactsInitialized=false;activeChat=null;if(!user){currentUser=currentProfile=null;showLogin();return}currentUser=user;try{const s=await getDoc(doc(db,"users",user.uid));if(!s.exists()){await signOut(auth);return showLogin("الحساب غير مُجهّز في Firestore.")}currentProfile={id:user.uid,...s.data()};currentProfile.displayName ||= currentProfile.username;renderMe();showChat();startPresence();await loadContacts()}catch(e){console.error(e);showLogin("تعذر تحميل الحساب. راجع إعدادات Firebase.")}});
function renderMe(){applyMyTheme();$("myName").textContent=currentProfile.displayName||currentProfile.username;paintAvatar($("myAvatar"),currentProfile);paintAvatar($("profileAvatarPreview"),currentProfile)}
async function writeMyPresence(online){if(!currentUser)return;const patch=online?{isOnline:true,lastActiveAt:serverTimestamp()}:{isOnline:false,lastSeenAt:serverTimestamp(),lastActiveAt:serverTimestamp()};await updateDoc(doc(db,"users",currentUser.uid),patch);if(currentProfile)Object.assign(currentProfile,online?{isOnline:true}:{isOnline:false,lastActiveAt:Date.now(),lastSeenAt:Date.now()});}
function startPresence(){stopPresence();const heartbeat=()=>{if(!currentUser||document.visibilityState==="hidden")return;writeMyPresence(true).catch(e=>console.warn("Presence update failed:",e));};heartbeat();presenceHeartbeat=setInterval(heartbeat,25000);presenceUiTimer=setInterval(refreshPresenceUI,15000);}
function stopPresence(){if(presenceHeartbeat)clearInterval(presenceHeartbeat);if(presenceUiTimer)clearInterval(presenceUiTimer);presenceHeartbeat=presenceUiTimer=null;}
document.addEventListener("visibilitychange",()=>{if(!currentUser)return;if(document.visibilityState==="hidden")writeMyPresence(false).catch(()=>{});else writeMyPresence(true).catch(e=>console.warn("Presence update failed:",e));});
window.addEventListener("pagehide",()=>{if(currentUser)writeMyPresence(false).catch(()=>{});});
window.addEventListener("online",()=>{if(currentUser&&document.visibilityState!=="hidden")writeMyPresence(true).catch(()=>{});});
window.addEventListener("offline",()=>{if(currentUser)writeMyPresence(false).catch(()=>{});});
function timestampMs(value){if(!value)return 0;if(typeof value.toMillis==="function")return value.toMillis();if(value instanceof Date)return value.getTime();if(typeof value==="number")return value;return 0;}
function presenceInfo(profile){const activeAt=timestampMs(profile?.lastActiveAt),online=!!profile?.isOnline&&(!activeAt||Date.now()-activeAt<PRESENCE_STALE_MS);if(online)return {online:true,text:"متصل الآن"};const lastSeen=Math.max(timestampMs(profile?.lastSeenAt),activeAt);if(!lastSeen)return {online:false,text:"غير متصل"};const diff=Math.max(0,Date.now()-lastSeen),minutes=Math.floor(diff/60000);if(minutes<1)return {online:false,text:"آخر ظهور منذ لحظات"};if(minutes<60)return {online:false,text:`آخر ظهور منذ ${minutes} دقيقة`};const d=new Date(lastSeen),today=new Date();const sameDay=d.toDateString()===today.toDateString();const yesterday=new Date(today);yesterday.setDate(today.getDate()-1);const isYesterday=d.toDateString()===yesterday.toDateString();const time=d.toLocaleTimeString("ar-EG",{hour:"2-digit",minute:"2-digit"});if(sameDay)return {online:false,text:`آخر ظهور اليوم ${time}`};if(isYesterday)return {online:false,text:`آخر ظهور أمس ${time}`};return {online:false,text:`آخر ظهور ${d.toLocaleDateString("ar-EG",{day:"numeric",month:"short"})} ${time}`};}
function updateContactCard(profile){const button=[...$("contacts").querySelectorAll(".contact")].find(b=>b.dataset.userId===profile.id);if(!button)return;const info=presenceInfo(profile),status=button.querySelector(".contact-status"),dot=button.querySelector(".presence-dot");if(status)status.textContent=info.text;if(dot){dot.classList.toggle("is-online",info.online);dot.title=info.text;}}
function updateActiveChatPresence(){if(!activeChat||activeChat.kind==="group")return;const profile=userProfiles.get(activeChat.id)||activeChat,info=presenceInfo(profile);$("chatSubtitle").textContent=info.text;$("chatHeader").classList.toggle("is-online",info.online);}
function refreshPresenceUI(){userProfiles.forEach(p=>updateContactCard(p));updateActiveChatPresence();}
async function loadContacts(){
  stopUnreadListeners();if(stopContacts)stopContacts();
  stopContacts=onSnapshot(collection(db,"users"),snapshot=>{
    const users=snapshot.docs.map(d=>({id:d.id,...d.data()}));
    userProfiles.clear();users.forEach(u=>userProfiles.set(u.id,u));
    if(currentProfile){const mine=userProfiles.get(currentUser.uid);if(mine)currentProfile={...currentProfile,...mine};userProfiles.set(currentUser.uid,currentProfile);}
    GROUP.participants=users.map(u=>u.id);
    const ids=users.filter(u=>u.id!==currentUser.uid).map(u=>u.id).sort().join("|");
    const oldIds=[...$("contacts").querySelectorAll(".contact[data-user-id]")].map(b=>b.dataset.userId).sort().join("|");
    if(!contactsInitialized||ids!==oldIds){const groupBtn=contactButton(GROUP,true);contactsElReplace(groupBtn);users.filter(u=>u.id!==currentUser.uid).forEach(p=>$ ("contacts").appendChild(contactButton(p,false)));if(!contactsInitialized){watchUnreadThread(GROUP_ID);users.filter(u=>u.id!==currentUser.uid).forEach(p=>watchUnreadThread(threadId(currentUser.uid,p.id)));}contactsInitialized=true;unreadCounts.forEach((_,thread)=>updateUnreadBadge(thread));}
    else users.filter(u=>u.id!==currentUser.uid).forEach(updateContactCard);
    refreshPresenceUI();
  },error=>{console.error("Contacts listener failed:",error);toast("تعذر تحديث حالة الأصدقاء");});
}
function contactsElReplace(groupBtn){$("contacts").innerHTML="";$("contacts").appendChild(groupBtn)}
function contactButton(p,group){
  const b=document.createElement("button");b.className="contact";
  b.dataset.threadId=group?GROUP_ID:threadId(currentUser.uid,p.id);if(!group)b.dataset.userId=p.id;
  b.style.setProperty("--contact-color",group?"#a78be8":colorOf(p));
  const info=group?{online:false,text:"التلاتة مع بعض ✨"}:presenceInfo(p);
  b.innerHTML=`${group?'<div class="group-avatar">♡<small>3</small></div>':`<span class="contact-avatar-wrap">${avatarMarkup(p)}<i class="presence-dot ${info.online?'is-online':''}" title="${$safe(info.text)}"></i></span>`}<div class="contact-details"><strong style="color:${group?'#a78be8':colorOf(p)}">${$safe(group?"S.T.M 🌷":p.displayName||p.username)}</strong><small class="contact-status">${$safe(info.text)}</small></div>`;
  b.onclick=()=>openChat(p);return b;
}
async function openChat(target){
  const openVersion=++chatOpenVersion;
  activeChat=target;
  replyTarget=null;
  editingId=null;
  $("replyPreview").classList.add("hidden");
  $("stickerTray").classList.add("hidden");
  document.querySelectorAll(".contact").forEach(x=>x.classList.remove("selected"));
  [...$("contacts").children].find(x=>x.querySelector("strong")?.textContent===(target.kind==="group"?"S.T.M 🌷":target.displayName||target.username))?.classList.add("selected");
  $("emptyState").classList.add("hidden");
  $("activeChat").classList.remove("hidden");
  $("chatName").textContent=target.kind==="group"?"S.T.M 🌷":target.displayName||target.username;
  $("chatHeader").style.setProperty("--chat-color",target.kind==="group"?"#a78be8":colorOf(target));
  $("chatSubtitle").textContent=target.kind==="group"?"Samaa · Tuqa · Menna":presenceInfo(userProfiles.get(target.id)||target).text;$("chatHeader").classList.remove("is-online");
  renderChatAvatar(target);
  updateActiveChatPresence();
  $("pinnedBar").classList.add("hidden");
  if(stopMessages){
    stopMessages();
    stopMessages=null;
  }

  const id=target.kind==="group"?GROUP_ID:threadId(currentUser.uid,target.id);
  setThreadRead(id);
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
    let firstMessagesSnapshot=true;
    const unsubscribe=onSnapshot(q,s=>{
      if(openVersion!==chatOpenVersion)return;
      if(!activeChat)return;
      const currentId=activeChat.kind==="group"?GROUP_ID:threadId(currentUser.uid,activeChat.id);
      if(currentId!==id)return;
      if(!firstMessagesSnapshot && s.docChanges().some(change=>change.type==="added"&&change.doc.data().senderId!==currentUser.uid))playIncomingSound();
      firstMessagesSnapshot=false;
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
function renderMessages(docs){
  const box=$("messages");box.innerHTML="";const pinned=[];
  const messages=docs.map(d=>({id:d.id,...d.data()}));
  messages.forEach((m,index)=>{
    if(m.pinned)pinned.push(m);
    const row=messageNode(m);
    const next=messages[index+1];
    // Keep the avatar only on the last message in each consecutive sender group.
    if(next && next.senderId===m.senderId){
      const avatar=row.querySelector(".message-avatar");
      if(avatar)avatar.classList.add("is-hidden-in-run");
    }
    box.appendChild(row);
  });
  const pinnedBar=$("pinnedBar");
  pinnedBar.innerHTML="";
  if(pinned.length){
    pinnedBar.classList.remove("hidden");
    const heading=document.createElement("span");heading.className="pinned-heading";heading.textContent="📌 المثبتة";pinnedBar.appendChild(heading);
    const list=document.createElement("div");list.className="pinned-items";
    pinned.forEach(m=>{
      const button=document.createElement("button");button.type="button";button.className="pinned-item";button.dataset.jump=m.id;
      const who=document.createElement("b");who.textContent=m.senderName||"رسالة";
      const preview=document.createElement("span");preview.textContent=(m.text|| (m.sticker?"ملصق":"رسالة مثبتة")).slice(0,55);
      button.append(who,preview);list.appendChild(button);
    });
    pinnedBar.appendChild(list);
  }else pinnedBar.classList.add("hidden");
  box.scrollTop=box.scrollHeight;
}
function jumpToMessage(messageId){
  if(!messageId)return;
  const target=document.getElementById(`message-${messageId}`);
  if(!target){toast("الرسالة دي مش موجودة في المحادثة الحالية");return;}
  target.scrollIntoView({behavior:"smooth",block:"center"});
  target.classList.remove("message-jump-highlight");
  // Restart the short highlight if the user jumps to the same message again.
  void target.offsetWidth;
  target.classList.add("message-jump-highlight");
  clearTimeout(target._jumpHighlightTimer);
  target._jumpHighlightTimer=setTimeout(()=>target.classList.remove("message-jump-highlight"),2000);
}
function messageNode(m){
  const mine=m.senderId===currentUser.uid,el=document.createElement("article");
  el.className=`message ${mine?"mine":"theirs"}`;
  el.id=`message-${m.id}`;
  const sender=userProfiles.get(m.senderId)||{};
  const senderPhoto=m.senderPhotoURL||sender.photoURL||"";
  const senderColor=sender.id?colorOf(sender):(m.senderColor||colorOf(sender));
  el.style.setProperty("--sender-color",senderColor);
  const senderInitial=(m.senderName||sender.displayName||sender.username||"♡").slice(0,1);
  const avatar=document.createElement("div");
  avatar.className="avatar message-avatar";
  avatar.style.setProperty("--user-color",senderColor);
  avatar.innerHTML=senderPhoto?`<img src="${$safe(senderPhoto)}" alt="">`:$safe(senderInitial);

  const reply=m.replyTo?`<button class="reply-quote" type="button" data-jump="${$safe(m.replyTo.id||"")}" ${m.replyTo.id?"":"disabled"}><b>${$safe(m.replyTo.senderName)}</b><span>${$safe(m.replyTo.text)}</span></button>`:"";
  const content=m.sticker?`<img class="sticker-image" src="${$safe(m.sticker)}" alt="ملصق">`:`<p>${$safe(m.text||"")}</p>`;
  const reactions=Object.entries(m.reactions||{}).filter(([k,v])=>Array.isArray(v)&&v.length).map(([k,v])=>`<button class="reaction-chip" data-emoji="${$safe(k)}">${$safe(k)} ${v.length}</button>`).join("");
  el.innerHTML=`${!mine?`<small class="sender-name" style="color:${$safe(senderColor)}">${$safe(m.senderName||"صديق")}</small>`:""}${m.pinned?'<div class="pin-mark">📌 مثبتة</div>':""}${reply}${content}<div class="message-meta"><time>${timeOf(m.createdAt)}</time>${m.edited?'<span>تم التعديل</span>':""}</div><div class="message-tools"><button class="message-more" data-action="menu" type="button" aria-label="خيارات الرسالة" aria-expanded="false">···</button><div class="message-actions-menu" hidden><button data-action="reply" type="button">↩ <span>رد</span></button><button data-action="react" type="button">☺ <span>تفاعل</span></button><button data-action="pin" type="button">📌 <span>${m.pinned?"إلغاء التثبيت":"تثبيت"}</span></button>${mine&&!m.sticker?'<button data-action="edit" type="button">✎ <span>تعديل</span></button>':""}</div></div><div class="reaction-list">${reactions}</div><div class="reaction-picker hidden">${["❤️","😂","🥰","👍","✨","😢","🔥","👏"].map(x=>`<button data-react="${x}" type="button">${x}</button>`).join("")}</div>`;
  const row=document.createElement("div");
  row.className=`message-row ${mine?"mine":"theirs"}`;
  row.appendChild(avatar);row.appendChild(el);
  row.querySelectorAll("[data-action]").forEach(btn=>btn.onclick=()=>handleMessageAction(btn.dataset.action,m,el,btn));
  row.querySelectorAll("[data-react]").forEach(btn=>btn.onclick=()=>{reactTo(m,btn.dataset.react);el.querySelector(".reaction-picker").classList.add("hidden")});
  row.querySelectorAll(".reaction-chip").forEach(btn=>btn.onclick=()=>reactTo(m,btn.dataset.emoji));
  row.querySelectorAll("[data-jump]").forEach(btn=>btn.addEventListener("click",()=>jumpToMessage(btn.dataset.jump)));
  return row;
}
async function handleMessageAction(action,m,el,button){
  const menu=el.querySelector(".message-actions-menu"),trigger=el.querySelector(".message-more");
  if(action==="menu"){
    const open=menu.hidden;document.querySelectorAll(".message-actions-menu:not([hidden])").forEach(other=>{other.hidden=true;other.parentElement.querySelector(".message-more")?.setAttribute("aria-expanded","false")});
    menu.hidden=!open;trigger?.setAttribute("aria-expanded",String(open));return;
  }
  menu.hidden=true;trigger?.setAttribute("aria-expanded","false");
  if(action==="reply"){replyTarget=m;editingId=null;$("replyText").textContent=`رد على ${m.senderName}: ${(m.text||"ملصق").slice(0,90)}`;$("replyPreview").classList.remove("hidden");$("messageInput").focus()}
  if(action==="edit"){if(m.senderId!==currentUser.uid)return;editingId=m.id;replyTarget=null;$("messageInput").value=m.text||"";$("messageInput").focus();toast("عدّل الرسالة ثم اضغط إرسال")}
  if(action==="pin"){await updateDoc(doc(db,"threads",activeThreadId(),"messages",m.id),{pinned:!m.pinned});toast(m.pinned?"تم إلغاء التثبيت":"تم تثبيت الرسالة")}
  if(action==="react")el.querySelector(".reaction-picker").classList.toggle("hidden");
}
// Jump to a pinned message from the organized pinned strip.
$("pinnedBar").addEventListener("click",event=>{const item=event.target.closest("[data-jump]");if(item)jumpToMessage(item.dataset.jump)});
async function reactTo(m,emoji){const r=doc(db,"threads",activeThreadId(),"messages",m.id),snap=await getDoc(r),data=snap.data()||{},reactions={...(data.reactions||{})},arr=[...(reactions[emoji]||[])];reactions[emoji]=arr.includes(currentUser.uid)?arr.filter(x=>x!==currentUser.uid):[...arr,currentUser.uid];await updateDoc(r,{reactions});}
$("messageForm").addEventListener("submit",async e=>{e.preventDefault();const input=$("messageInput"),text=input.value.trim();if(!text||!activeChat)return;const tid=activeThreadId();try{if(editingId){await updateDoc(doc(db,"threads",tid,"messages",editingId),{text,edited:true,editedAt:serverTimestamp()});editingId=null}else{const payload={text,senderId:currentUser.uid,senderName:currentProfile.displayName||currentProfile.username,senderColor:colorOf(currentProfile),senderPhotoURL:currentProfile.photoURL||"",createdAt:serverTimestamp()};if(replyTarget)payload.replyTo={id:replyTarget.id,text:replyTarget.text||"ملصق",senderName:replyTarget.senderName||"صديق"};playSound("messageSound");const sent=await addDoc(collection(db,"threads",tid,"messages"),payload);notifyRecipients(tid,sent.id)}input.value="";replyTarget=null;$("replyPreview").classList.add("hidden");await updateDoc(doc(db,"threads",tid),{updatedAt:serverTimestamp()})}catch(err){console.error(err);toast("تعذر حفظ الرسالة. راجع قواعد Firestore")}});
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


/* Cinematic credits */
const creditsModal = $("creditsModal");
const creditsMusic = $("creditsMusic");
const openCredits = () => {
  if (!creditsModal) return;
  creditsModal.classList.remove("hidden");
  document.body.classList.add("credits-open");
  if (creditsMusic) {
    creditsMusic.currentTime = 0;
    const playback = creditsMusic.play();
    if (playback && typeof playback.catch === "function") playback.catch(error => console.warn("تعذر تشغيل موسيقى الحقوق:", error));
  }
  $("closeCredits")?.focus();
};
const closeCredits = () => {
  creditsModal?.classList.add("hidden");
  document.body.classList.remove("credits-open");
  if (creditsMusic) { creditsMusic.pause(); creditsMusic.currentTime = 0; }
  $("creditsBtn")?.focus();
};
$("creditsBtn")?.addEventListener("click", openCredits);
$("closeCredits")?.addEventListener("click", closeCredits);
creditsModal?.addEventListener("click", event => { if (event.target === creditsModal) closeCredits(); });
document.addEventListener("keydown", event => { if (event.key === "Escape" && creditsModal && !creditsModal.classList.contains("hidden")) closeCredits(); });


// Smooth sidebar collapse/expand handle. Keep the chat and message area intact.
const sidebarToggle = document.getElementById("sidebarToggle");
const chatLayout = document.querySelector(".chat-view");
if (sidebarToggle && chatLayout) {
  const collapsed = localStorage.getItem("bubble-chat-sidebar-collapsed") === "true";
  const applySidebarState = (isCollapsed) => {
    chatLayout.classList.toggle("sidebar-collapsed", isCollapsed);
    sidebarToggle.textContent = isCollapsed ? "›" : "‹";
    sidebarToggle.setAttribute("aria-expanded", String(!isCollapsed));
    sidebarToggle.setAttribute("aria-label", isCollapsed ? "إظهار الشريط الجانبي" : "إخفاء الشريط الجانبي");
    sidebarToggle.title = isCollapsed ? "إظهار الشريط الجانبي" : "إخفاء الشريط الجانبي";
    localStorage.setItem("bubble-chat-sidebar-collapsed", String(isCollapsed));
  };
  applySidebarState(collapsed);
  sidebarToggle.addEventListener("click", () => {
    applySidebarState(!chatLayout.classList.contains("sidebar-collapsed"));
  });
}
