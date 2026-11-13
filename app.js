// Remove accidental visible escaped-newline fragments left by malformed markup.
function removeEscapedNewlineArtifacts(root=document.body){
  if(!root)return;
  const walker=document.createTreeWalker(root,NodeFilter.SHOW_TEXT);
  const remove=[];
  while(walker.nextNode()){
    const value=walker.currentNode.nodeValue||"";
    if(/^\s*n(?:\s*\\n\s*n){1,}\s*\\?\s*$/i.test(value))remove.push(walker.currentNode);
  }
  remove.forEach(node=>node.remove());
}
if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",()=>removeEscapedNewlineArtifacts(),{once:true});
else removeEscapedNewlineArtifacts();

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js";
import { getAuth, signInWithEmailAndPassword, signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";
import { getFirestore, collection, doc, getDoc, getDocs, query, orderBy, onSnapshot, addDoc, setDoc, updateDoc, deleteDoc, arrayUnion, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";
import { getMessaging, getToken, isSupported } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-messaging.js";
import { firebaseConfig } from "./firebase-config.js";

const app=initializeApp(firebaseConfig), auth=getAuth(app), db=getFirestore(app);
const CLOUDINARY_CLOUD_NAME="svigkr4e", CLOUDINARY_UPLOAD_PRESET="chat_upload";
const NOTIFICATION_WORKER_URL="https://bubble-chat-notifications.mainmohammedy.workers.dev";
const VAPID_PUBLIC_KEY="BNntJ7Pft1mjX9eAemavXWmOmjrZj9I-VDyV-zsqFm-otZV0WKadTAcgjUKJOrexkCzmhC2Lmy7tB2tqcQ5PXuI";
const $=id=>document.getElementById(id); let currentUser=null,currentProfile=null,activeChat=null,stopMessages=null,chatOpenVersion=0,replyTarget=null,editingId=null,selectedAvatarFile=null,selectedBannerFile=null;
const unreadStops=new Map(), unreadCounts=new Map();
let sharedStickers=[],stopSharedStickers=null;
let activeMessagesCache=[],activeGroupMeta={name:"S.T.M 🌷",photoURL:"",bannerURL:"",admins:[]};
let stopContacts=null,presenceHeartbeat=null,presenceUiTimer=null,contactsInitialized=false,stopTypingListener=null,typingTimeout=null,typingWriteAt=0;
const PRESENCE_STALE_MS=65000; // بعد فقد الاتصال/إغلاق التطبيق يتحول الحساب تلقائيًا إلى غير متصل.
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
// Prevent browser text selection, image dragging and the native long-press menu across the app.
// Inputs and textareas remain editable/selectable so typing and copying form content still work.
document.addEventListener("contextmenu",event=>{
  if(event.target.closest("input,textarea,[contenteditable='true']"))return;
  event.preventDefault();
},{capture:true});
document.addEventListener("dragstart",event=>{if(event.target.closest("img"))event.preventDefault();},{capture:true});

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
  const button=[...$("contacts").querySelectorAll(".contact")].find(b=>b.dataset.threadId===thread);if(!button){updateCollapsedUnreadIndicator();return;}
  let badge=button.querySelector(".unread-badge");const count=unreadCounts.get(thread)||0;
  if(count>0){if(!badge){badge=document.createElement("span");badge.className="unread-badge";badge.setAttribute("aria-label","رسائل غير مقروءة");button.appendChild(badge);}badge.textContent=count>99?"99+":String(count);}
  else badge?.remove();
  updateCollapsedUnreadIndicator();
  window.__bubbleSyncMiniDock?.();
}
function updateCollapsedUnreadIndicator(){
  const indicator=$("collapsedUnreadIndicator");if(!indicator)return;
  const collapsed=$("chatView")?.classList.contains("sidebar-collapsed");
  const total=[...unreadCounts.values()].reduce((sum,count)=>sum+count,0);
  $("collapsedUnreadCount").textContent=total>99?"99+":String(total);
  indicator.classList.toggle("hidden",!collapsed||total===0);
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
function colorOf(p){return p?.color1||p?.color||({Samaa:"#55cbd5",Tuqa:"#ed8fbd",Menna:"#a78be8"}[p?.username]||"#a78be8")}
function profileGradient(p){return `linear-gradient(120deg,${p?.color1||p?.color||colorOf(p)},${p?.color2||p?.color1||p?.color||colorOf(p)})`}
function avatarGradient(p){return "linear-gradient(135deg,#5865f2,#eb459e)"}
function nameStyle(p){
 const fonts={noto:"'Noto Sans','Noto Sans Arabic','Noto Sans JP','Noto Sans SC','Noto Sans KR',sans-serif",arabic:"'Noto Sans Arabic','Noto Sans',sans-serif",serif:"'Noto Serif','Noto Naskh Arabic',serif","arabic-serif":"'Noto Naskh Arabic','Noto Serif',serif",mono:"'Noto Sans Mono','Noto Sans Arabic',monospace",kufi:"'Noto Kufi Arabic','Noto Sans',sans-serif"};
 return `font-family:${fonts[p?.nameFont]||fonts.noto};font-weight:700;background-image:${profileGradient(p)};background-clip:text;-webkit-background-clip:text;color:transparent`
}
function decorationUrl(value){return value?`./${String(value).replace(/[^1-4]/g,'')}.gif`:""}
function applyMyTheme(){if(currentProfile)document.documentElement.style.setProperty("--theme-color",colorOf(currentProfile))}
function avatarMarkup(p,size=""){
  const color=colorOf(p),photo=p?.photoURL,initial=(p?.displayName||p?.username||"♡").slice(0,1);
  return `<div class="avatar ${size}" style="--user-color:${color};background-image:${avatarGradient(p)}">${photo?`<span class="avatar-fallback">${$safe(initial)}</span><img src="${$safe(photo)}" alt="" loading="lazy" decoding="async" onerror="this.remove()">`:$safe(initial)}${p?.decoration?`<span class="chat-avatar-decoration"><img src="${decorationUrl(p.decoration)}" alt=""></span>`:""}</div>`;
}
function paintAvatar(element,profile){
  if(!element)return;
  const initial=(profile?.displayName||profile?.username||"♡").slice(0,1);
  const photo=profile?.photoURL;
  element.style.setProperty("--user-color",colorOf(profile));
  element.style.backgroundImage=avatarGradient(profile);
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
    avatar.innerHTML=activeGroupMeta.photoURL?`<img src="${$safe(activeGroupMeta.photoURL)}" alt="">`:'♡<small>3</small>';
    return;
  }
  avatar.className="avatar";
  avatar.style.setProperty("--user-color",colorOf(target));
  avatar.style.backgroundImage=avatarGradient(target);
  const photo=target.photoURL;
  paintAvatar(avatar,target);
}
function toast(t){const el=$("toast");el.textContent=t;el.classList.remove("hidden");clearTimeout(toast.timer);toast.timer=setTimeout(()=>el.classList.add("hidden"),2600)}
// PWA installation: show an install entry point to every visitor.
let deferredInstallPrompt = null;
const installAppBtn = $("installAppBtn");
function isAppInstalled() {
  return window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone === true;
}
function refreshInstallButton() {
  if (installAppBtn) installAppBtn.classList.toggle("hidden", isAppInstalled());
}
window.addEventListener("beforeinstallprompt", event => {
  event.preventDefault();
  deferredInstallPrompt = event;
  refreshInstallButton();
});
window.addEventListener("appinstalled", () => {
  deferredInstallPrompt = null;
  refreshInstallButton();
  toast("تم تثبيت Bubble Chat بنجاح ♡");
});
installAppBtn?.addEventListener("click", async () => {
  if (isAppInstalled()) return refreshInstallButton();
  if (deferredInstallPrompt) {
    deferredInstallPrompt.prompt();
    const choice = await deferredInstallPrompt.userChoice;
    if (choice?.outcome === "accepted") toast("جاري تثبيت Bubble Chat ♡");
    deferredInstallPrompt = null;
    return;
  }
  const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
  toast(isIOS
    ? 'لتثبيته: اضغط «مشاركة» ثم «إضافة إلى الشاشة الرئيسية».'
    : 'لو خيار التثبيت مش ظاهر تلقائيًا: افتح قائمة ⋮ في المتصفح ثم «تثبيت التطبيق» أو «إضافة إلى الشاشة الرئيسية».');
});
refreshInstallButton();
// Register the messaging worker immediately, including before login.
if ("serviceWorker" in navigator) {
  const workerUrl = new URL("./firebase-messaging-sw.js", import.meta.url);
  const workerScope = new URL("./", import.meta.url).pathname;
  window.addEventListener("load", () => {
    navigator.serviceWorker.register(workerUrl.href, { scope: workerScope })
      .catch(error => console.warn("تعذر تسجيل Service Worker:", error));
  }, { once: true });
}


function timeOf(ts){return ts?.toDate?ts.toDate().toLocaleTimeString("ar-EG",{hour:"2-digit",minute:"2-digit"}):"الآن"}
function showLogin(msg=""){$("loginView").classList.remove("hidden");$("chatView").classList.add("hidden");$("loginError").textContent=msg}
function showChat(){$("loginView").classList.add("hidden");$("chatView").classList.remove("hidden")}
// A fresh page load always starts without an active conversation. In that state,
// the sidebar must be expanded so the user can choose a chat; the mini dock only
// belongs to an already-open conversation.
function expandSidebarWhenNoChat(){
  if(activeChat)return;
  const layout=$("chatView");
  const toggle=$("sidebarToggle");
  if(!layout)return;
  layout.classList.remove("sidebar-collapsed");
  localStorage.setItem("bubble-chat-sidebar-collapsed","false");
  if(toggle){
    toggle.textContent="‹";
    toggle.setAttribute("aria-expanded","true");
    toggle.setAttribute("aria-label","إخفاء الشريط الجانبي");
    toggle.title="إخفاء الشريط الجانبي";
  }
  updateCollapsedUnreadIndicator();
}

async function enablePushNotifications(){
  if(!currentUser)throw new Error("سجّلي الدخول أولًا");
  if(!("serviceWorker" in navigator) || !("Notification" in window))throw new Error("المتصفح لا يدعم إشعارات الويب");
  if(!(await isSupported()))throw new Error("إشعارات Firebase غير مدعومة في هذا المتصفح");
  const permission=await Notification.requestPermission();
  if(permission!=="granted")throw new Error("لم يتم السماح بالإشعارات");
  // Resolve the worker relative to this app file so GitHub Pages repo paths work.
  const swUrl = new URL("./firebase-messaging-sw.js", import.meta.url);
  const appScope = new URL("./", import.meta.url);
  let registration;
  try {
    registration = await navigator.serviceWorker.register(swUrl.href, { scope: appScope.pathname });
    await navigator.serviceWorker.ready;
  } catch (error) {
    console.error("Service worker registration failed:", { swUrl: swUrl.href, scope: appScope.pathname, error });
    throw new Error(`تعذر تسجيل ملف الإشعارات (${error?.message || error})`);
  }
  const messaging=getMessaging(app);
  let token;
  try {
    token=await getToken(messaging,{vapidKey:VAPID_PUBLIC_KEY,serviceWorkerRegistration:registration});
  } catch (error) {
    console.error("Firebase push token failed:", error);
    // بعض أخطاء Push تكون DOMException ويكون error.code رقمًا وليس نصًا.
    // تحويل القيم إلى نص يمنع ظهور TypeError الذي كان يخفي الخطأ الأصلي.
    const code = String(error?.code ?? error?.name ?? "unknown");
    const message = String(error?.message ?? error ?? "حدث خطأ غير معروف");
    if (/push-service|token-subscribe-failed/i.test(code) || /push service/i.test(message)) {
      throw new Error(`فشل الاتصال بخدمة Push في المتصفح: ${message}. تأكد من HTTPS، ثم أعد ضبط إذن الإشعارات وبيانات الموقع وجرب مرة أخرى.`);
    }
    throw new Error(`فشل إنشاء رمز الإشعارات (${code}): ${message}`);
  }
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
onAuthStateChanged(auth,async user=>{chatOpenVersion++;if(stopMessages){stopMessages();stopMessages=null}stopUnreadListeners();if(stopContacts){stopContacts();stopContacts=null}if(stopSharedStickers){stopSharedStickers();stopSharedStickers=null}sharedStickers=[];stopPresence();contactsInitialized=false;activeChat=null;if(!user){currentUser=currentProfile=null;showLogin();return}currentUser=user;try{const s=await getDoc(doc(db,"users",user.uid));if(!s.exists()){await signOut(auth);return showLogin("الحساب غير مُجهّز في Firestore.")}currentProfile={id:user.uid,...s.data()};currentProfile.displayName ||= currentProfile.username;renderMe();showChat();startPresence();startSharedStickerListener();await loadContacts()}catch(e){console.error(e);showLogin("تعذر تحميل الحساب. راجع إعدادات Firebase.")}});
function renderMe(){applyMyTheme();$("myName").textContent=currentProfile.displayName||currentProfile.username;$("myName").style.cssText=nameStyle(currentProfile);const ownPresence=$("myAvatar")?.parentElement?.querySelector(".online-dot");if(ownPresence){ownPresence.classList.toggle("is-idle",currentProfile.presenceState==="idle");ownPresence.classList.toggle("is-invisible",currentProfile.presenceState==="invisible");}paintAvatar($("myAvatar"),currentProfile);if(currentProfile.decoration){$("myAvatar").insertAdjacentHTML("beforeend",`<span class="chat-avatar-decoration"><img src="${decorationUrl(currentProfile.decoration)}" alt=""></span>`)}paintAvatar($("profileAvatarPreview"),currentProfile);$("profileAvatarPreview").style.width=$("profileAvatarPreview").style.height="96px";$("myAvatar").style.width=$("myAvatar").style.height="64px";}
async function writeMyPresence(state){if(!currentUser)return;const normalized=state===true?"online":state===false?"invisible":state;const now=Date.now();const patch={presenceState:normalized,isOnline:normalized==="online",lastActiveAt:serverTimestamp()};if(normalized!=="online")patch.lastSeenAt=serverTimestamp();await updateDoc(doc(db,"users",currentUser.uid),patch);if(currentProfile)Object.assign(currentProfile,{presenceState:normalized,isOnline:normalized==="online",lastActiveAt:now,...(normalized!=="online"?{lastSeenAt:now}:{})});}
function startPresence(){stopPresence();const sync=()=>{if(!currentUser)return;writeMyPresence(document.visibilityState==="visible"?"online":"idle").catch(e=>console.warn("Presence update failed:",e));};sync();presenceHeartbeat=setInterval(sync,20000);presenceUiTimer=setInterval(refreshPresenceUI,10000);}
function stopPresence(){if(presenceHeartbeat)clearInterval(presenceHeartbeat);if(presenceUiTimer)clearInterval(presenceUiTimer);presenceHeartbeat=presenceUiTimer=null;}
document.addEventListener("visibilitychange",()=>{if(!currentUser)return;if(document.visibilityState==="hidden"){writeMyPresence("idle").catch(()=>{});stopTypingNow();}else writeMyPresence("online").catch(e=>console.warn("Presence update failed:",e));});
window.addEventListener("pagehide",()=>{if(currentUser)writeMyPresence("invisible").catch(()=>{});stopTypingNow();});
window.addEventListener("online",()=>{if(currentUser&&document.visibilityState==="visible")writeMyPresence("online").catch(()=>{});});
window.addEventListener("offline",()=>{if(currentUser)writeMyPresence("invisible").catch(()=>{});});
function timestampMs(value){if(!value)return 0;if(typeof value.toMillis==="function")return value.toMillis();if(value instanceof Date)return value.getTime();if(typeof value==="number")return value;return 0;}
function presenceInfo(profile){const activeAt=timestampMs(profile?.lastActiveAt),fresh=!!activeAt&&Date.now()-activeAt<PRESENCE_STALE_MS;let state=profile?.presenceState||(profile?.isOnline?"online":"invisible");if(!fresh)state="invisible";if(state==="online")return {state,online:true,text:"متصل الآن",icon:"●"};if(state==="idle")return {state,online:false,text:"خامل",icon:"☾"};return {state:"invisible",online:false,text:"غير متصل",icon:"●"};}
function updateContactCard(profile){const button=[...$("contacts").querySelectorAll(".contact")].find(b=>b.dataset.userId===profile.id);if(!button)return;const info=presenceInfo(profile),status=button.querySelector(".contact-status"),dot=button.querySelector(".presence-dot");if(status)status.textContent=info.text;if(dot){dot.classList.toggle("is-online",info.state==="online");dot.classList.toggle("is-idle",info.state==="idle");dot.classList.toggle("is-invisible",info.state==="invisible");dot.title=info.text;dot.textContent=info.icon;}}
function updateActiveChatPresence(){if(!activeChat||activeChat.kind==="group")return;const profile=userProfiles.get(activeChat.id)||activeChat,info=presenceInfo(profile);$("chatSubtitle").textContent=info.text;$("chatHeader").classList.toggle("is-online",info.state==="online");$("chatHeader").dataset.presenceState=info.state;}
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
    getDoc(doc(db,"threads",GROUP_ID)).then(groupSnap=>{
      if(groupSnap.exists()){
        const data=groupSnap.data();
        activeGroupMeta={name:data.groupName||"S.T.M 🌷",photoURL:data.groupPhotoURL||"",bannerURL:data.groupBannerURL||"",admins:data.admins||[]};
        refreshGroupSidebar();
      }
    }).catch(error=>console.warn("Could not load group settings:",error));
  },error=>{console.error("Contacts listener failed:",error);toast("تعذر تحديث حالة الأصدقاء");});
}
function contactsElReplace(groupBtn){$("contacts").innerHTML="";$("contacts").appendChild(groupBtn)}
function contactButton(p,group){
  const b=document.createElement("button");b.className="contact";
  b.dataset.threadId=group?GROUP_ID:threadId(currentUser.uid,p.id);if(!group)b.dataset.userId=p.id;
  b.style.setProperty("--contact-color",group?"#a78be8":colorOf(p));
  const info=group?{online:false,text:"التلاتة مع بعض ✨"}:presenceInfo(p);
  b.innerHTML=`${group?`<div class="group-avatar">${activeGroupMeta.photoURL?`<img src="${$safe(activeGroupMeta.photoURL)}" alt="">`:'♡<small>3</small>'}</div>`:`<span class="contact-avatar-wrap">${avatarMarkup(p)}<i class="presence-dot is-${info.state}" title="${$safe(info.text)}">${info.icon}</i></span>`}<div class="contact-details"><strong style="${group?'color:#a78be8':nameStyle(p)}">${$safe(group?(activeGroupMeta.name||"S.T.M 🌷"):p.displayName||p.username)}</strong><small class="contact-status">${$safe(info.text)}</small></div>`;
  b.onclick=()=>openChat(p);return b;
}
function refreshGroupSidebar(){
  const button=[...$("contacts").querySelectorAll(".contact")].find(item=>item.dataset.threadId===GROUP_ID);
  if(!button)return;
  const title=button.querySelector("strong");if(title)title.textContent=activeGroupMeta.name||"S.T.M 🌷";
  const avatar=button.querySelector(".group-avatar");
  if(avatar)avatar.innerHTML=activeGroupMeta.photoURL?`<img src="${$safe(activeGroupMeta.photoURL)}" alt="">`:'♡<small>3</small>';
}
function syncMiniDockAfterChatOpen(){window.__bubbleSyncMiniDock?.();}
async function openChat(target){
  const openVersion=++chatOpenVersion;
  if(stopTypingListener){stopTypingListener();stopTypingListener=null;}
  stopTypingNow();
  activeChat=target;
  replyTarget=null;
  editingId=null;
  $("replyPreview").classList.add("hidden");
  $("stickerTray").classList.add("hidden");
  document.querySelectorAll(".contact").forEach(x=>x.classList.remove("selected"));
  [...$("contacts").children].find(x=>x.dataset.threadId===(target.kind==="group"?GROUP_ID:threadId(currentUser.uid,target.id)))?.classList.add("selected");
  document.querySelectorAll(".sidebar-mini-contact").forEach(button=>button.classList.remove("is-selected"));
  syncMiniDockAfterChatOpen();
  $("emptyState").classList.add("hidden");
  $("activeChat").classList.remove("hidden");
  $("chatName").textContent=target.kind==="group"?(activeGroupMeta.name||"S.T.M 🌷"):target.displayName||target.username;
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
  startTypingListener(id);
  setThreadRead(id);
  const ref=doc(db,"threads",id);

  try{
    const snap=await getDoc(ref);
    if(openVersion!==chatOpenVersion)return;

    if(!snap.exists()){
      await setDoc(ref,{
        kind:target.kind||"direct",
        ...(target.kind==="group"?{groupName:"S.T.M 🌷",groupPhotoURL:"",admins:[]}:{}),
        participants:(target.kind==="group"?GROUP.participants:[currentUser.uid,target.id]).sort(),
        participantNames:target.kind==="group"?USERNAMES:[currentProfile.username,target.username],
        createdAt:serverTimestamp(),
        updatedAt:serverTimestamp()
      });
      if(openVersion!==chatOpenVersion)return;
    }
    if(target.kind==="group"){
      const fresh=await getDoc(ref);
      activeGroupMeta={name:fresh.data()?.groupName||"S.T.M 🌷",photoURL:fresh.data()?.groupPhotoURL||"",bannerURL:fresh.data()?.groupBannerURL||"",admins:fresh.data()?.admins||[]};
      if(currentProfile?.username?.toLowerCase()==="tuqa"&&!activeGroupMeta.admins.includes(currentUser.uid)){
        activeGroupMeta.admins=[currentUser.uid,...activeGroupMeta.admins];
        await updateDoc(ref,{admins:activeGroupMeta.admins});
      }
      $("chatName").textContent=activeGroupMeta.name;renderChatAvatar(target);
      const groupNameNode=$("contacts").querySelector(".contact strong");if(groupNameNode)groupNameNode.textContent=activeGroupMeta.name;
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
function typingCollection(thread){return collection(db,"threads",thread,"typing");}
function startTypingListener(thread){
  if(stopTypingListener){stopTypingListener();stopTypingListener=null;}
  stopTypingListener=onSnapshot(typingCollection(thread),snapshot=>{
    const writers=snapshot.docs.map(d=>d.data()).filter(v=>v.uid!==currentUser?.uid&&Date.now()-(timestampMs(v.updatedAt)||0)<9000);
    const subtitle=$("chatSubtitle");if(!subtitle)return;
    if(writers.length){subtitle.textContent=writers.length===1?`${writers[0].displayName||"صديق"} يكتب...`:`${writers.length} بيكتبوا...`;subtitle.classList.add("is-typing");}
    else{subtitle.classList.remove("is-typing");updateActiveChatPresence();}
  },error=>console.warn("Typing listener failed:",error));
}
async function setTypingState(){
  if(!currentUser||!activeChat||!$("messageInput").value.trim())return;
  const now=Date.now();if(now-typingWriteAt<1800)return;typingWriteAt=now;
  const ref=doc(db,"threads",activeThreadId(),"typing",currentUser.uid);
  setDoc(ref,{uid:currentUser.uid,displayName:currentProfile.displayName||currentProfile.username,updatedAt:serverTimestamp()}).catch(e=>console.warn("Typing update failed:",e));
  clearTimeout(typingTimeout);typingTimeout=setTimeout(stopTypingNow,2600);
}
function stopTypingNow(){clearTimeout(typingTimeout);typingTimeout=null;if(!currentUser||!activeChat)return;const id=activeChat.kind==="group"?GROUP_ID:threadId(currentUser.uid,activeChat.id);deleteDoc(doc(db,"threads",id,"typing",currentUser.uid)).catch(()=>{});}
$("messageInput").addEventListener("input",()=>{const input=$("messageInput");input.style.height="auto";input.style.height=Math.min(input.scrollHeight,150)+"px";setTypingState();});
// Enter inserts a newline; sending is only through the send button.
$("messageInput").addEventListener("blur",stopTypingNow);
function activeThreadId(){return isGroup()?GROUP_ID:threadId(currentUser.uid,activeChat.id)}
function renderMessages(docs){
  const box=$("messages");box.innerHTML="";const pinned=[];
  const messages=docs.map(d=>({id:d.id,...d.data()})).filter(m=>!m.deletedForAll&&!(Array.isArray(m.deletedFor)&&m.deletedFor.includes(currentUser.uid)));
  activeMessagesCache=messages;
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
    pinned.sort((a,b)=>(timestampMs(b.pinnedAt)||timestampMs(b.createdAt))-(timestampMs(a.pinnedAt)||timestampMs(a.createdAt))).forEach(m=>{
      const button=document.createElement("button");button.type="button";button.className="pinned-item";button.dataset.jump=m.id;
      const who=document.createElement("b");who.textContent=m.senderName||"رسالة";
      const preview=document.createElement("span");preview.textContent=(m.text|| (m.sticker?"ملصق":"رسالة مثبتة")).slice(0,55);
      button.append(who,preview);list.appendChild(button);
    });
    pinnedBar.appendChild(list);
  }else pinnedBar.classList.add("hidden");
  box.scrollTop=box.scrollHeight;
  updateScrollBottomButton();
  if(!$("chatSearchPanel").classList.contains("hidden"))filterChatSearch();
}
const scrollBottomButton=$("scrollToBottom");
function updateScrollBottomButton(){const box=$("messages");if(!box||!scrollBottomButton)return;const away=box.scrollHeight-box.scrollTop-box.clientHeight>220;scrollBottomButton.classList.toggle("is-visible",away&&!$("activeChat").classList.contains("hidden"));}
$("messages").addEventListener("scroll",updateScrollBottomButton,{passive:true});
scrollBottomButton?.addEventListener("click",()=>$("messages").scrollTo({top:$("messages").scrollHeight,behavior:"smooth"}));
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
let contextMessage=null;
let contextLayer=null;
const QUICK_REACTIONS=["❤️","😂","🥰","👍","😮","😢"];
function closeMessageContext(){
  if(!contextLayer)return;
  contextLayer.remove();contextLayer=null;
  document.querySelectorAll('.message.is-context-selected').forEach(node=>node.classList.remove('is-context-selected'));
  contextMessage=null;
}
function showMessageContext(m,el){
  closeMessageContext();contextMessage=m;el.classList.add('is-context-selected');
  const layer=document.createElement('div');layer.className='message-context-layer';layer.setAttribute('role','dialog');layer.setAttribute('aria-label','خيارات الرسالة');
  const backdrop=document.createElement('button');backdrop.type='button';backdrop.className='message-context-backdrop';backdrop.setAttribute('aria-label','إغلاق الخيارات');backdrop.addEventListener('click',closeMessageContext);
  const panel=document.createElement('div');panel.className='message-context-panel';
  const reactions=document.createElement('div');reactions.className='message-context-reactions';
  QUICK_REACTIONS.forEach(emoji=>{const b=document.createElement('button');b.type='button';b.className='context-emoji';b.textContent=emoji;b.setAttribute('aria-label',`تفاعل ${emoji}`);b.addEventListener('click',async()=>{await reactTo(m,emoji);closeMessageContext()});reactions.appendChild(b)});
  const actions=document.createElement('div');actions.className='message-context-actions';
  const addAction=(label,icon,fn)=>{const b=document.createElement('button');b.type='button';b.className='context-action';b.innerHTML=`<span class="context-action-icon">${icon}</span><span>${label}</span>`;b.addEventListener('click',async()=>{closeMessageContext();await fn()});actions.appendChild(b)};
  addAction('رد','↩',()=>handleMessageAction('reply',m,el));
  addAction('نسخ','▢',async()=>{const value=m.text||'';if(!value)return toast('مفيش نص لنسخه');try{await navigator.clipboard.writeText(value);toast('تم نسخ الرسالة ♡')}catch(e){toast('تعذر النسخ على هذا المتصفح')}});
  addAction(m.pinned?'إلغاء التثبيت':'تثبيت','📌',()=>handleMessageAction('pin',m,el));
  if(m.senderId===currentUser.uid&&!m.sticker)addAction('تعديل','✎',()=>handleMessageAction('edit',m,el));
  addAction('حذف لدي','⌫',()=>handleMessageAction('delete-me',m,el));
  if(m.senderId===currentUser.uid)addAction('حذف لدى الجميع','🗑',()=>handleMessageAction('delete-all',m,el));
  panel.append(reactions,actions);layer.append(backdrop,panel);document.body.appendChild(layer);contextLayer=layer;
}
function beginMessageGestures(row,m,el){
  let startX=0,startY=0,lastX=0,lastY=0,pressTimer=null,tracking=false,longPressed=false,swiping=false;
  const clearPress=()=>{if(pressTimer){clearTimeout(pressTimer);pressTimer=null}};
  row.addEventListener('pointerdown',event=>{
    if(event.button!==undefined&&event.button!==0)return;
    if(event.target.closest('button,a,input,textarea'))return;
    tracking=true;longPressed=false;swiping=false;try{window.getSelection()?.removeAllRanges()}catch(_){}startX=lastX=event.clientX;startY=lastY=event.clientY;
    clearPress();pressTimer=setTimeout(()=>{if(!tracking||swiping)return;longPressed=true;try{window.getSelection()?.removeAllRanges()}catch(_){}showMessageContext(m,el)},460);
  });
  row.addEventListener('pointermove',event=>{
    if(!tracking)return;lastX=event.clientX;lastY=event.clientY;
    const dx=lastX-startX,dy=lastY-startY;
    if(Math.abs(dx)>10||Math.abs(dy)>10)clearPress();
    if(dx>0&&Math.abs(dx)>Math.abs(dy)*1.35){swiping=true;el.style.setProperty('--reply-swipe',`${Math.min(dx,76)}px`);el.classList.add('is-swiping-reply')}
  });
  const finish=()=>{
    if(!tracking)return;tracking=false;clearPress();
    const dx=lastX-startX,dy=lastY-startY;
    el.style.removeProperty('--reply-swipe');el.classList.remove('is-swiping-reply');
    if(!longPressed&&dx>64&&Math.abs(dx)>Math.abs(dy)*1.35){handleMessageAction('reply',m,el);el.classList.remove('reply-swipe-done');void el.offsetWidth;el.classList.add('reply-swipe-done');setTimeout(()=>el.classList.remove('reply-swipe-done'),260)}
  };
  row.addEventListener('pointerup',finish);row.addEventListener('pointercancel',finish);row.addEventListener('lostpointercapture',finish);
  row.addEventListener('contextmenu',event=>{event.preventDefault();try{window.getSelection()?.removeAllRanges()}catch(_){}showMessageContext(m,el)});
}
function messageNode(m){
  const mine=m.senderId===currentUser.uid,el=document.createElement('article');
  el.className=`message ${mine?'mine':'theirs'}`;el.id=`message-${m.id}`;
  const sender=(m.senderId===currentUser.uid?currentProfile:userProfiles.get(m.senderId))||{};
  const senderPhoto=m.senderPhotoURL||sender.photoURL||'';
  const senderColor=sender.id?colorOf(sender):(m.senderColor||colorOf(sender));
  el.style.setProperty('--sender-color',senderColor);
  const senderInitial=(m.senderName||sender.displayName||sender.username||'♡').slice(0,1);
  const avatar=document.createElement('div');avatar.className='avatar message-avatar';avatar.style.setProperty('--user-color',senderColor);avatar.style.backgroundImage=avatarGradient(sender);
  avatar.innerHTML=(senderPhoto?`<img src="${$safe(senderPhoto)}" alt="">`:$safe(senderInitial))+(sender.decoration?`<span class="chat-avatar-decoration"><img src="${decorationUrl(sender.decoration)}" alt=""></span>`:"");
  const reply=m.replyTo?`<button class="reply-quote" type="button" data-jump="${$safe(m.replyTo.id||'')}" ${m.replyTo.id?'':'disabled'}><b>${$safe(m.replyTo.senderName)}</b><span>${m.replyTo.sticker?'<img class="reply-sticker-thumb" src="'+$safe(m.replyTo.sticker)+'" alt="ملصق">':$safe(m.replyTo.text||"ملصق")}</span></button>`:'';
  const content=m.sticker?`<img class="sticker-image" src="${$safe(m.sticker)}" alt="ملصق">`:`<p>${$safe(m.text||'')}</p>`;
  const reactions=Object.entries(m.reactions||{}).filter(([k,v])=>Array.isArray(v)&&v.length).map(([emoji,uids])=>{
    const people=uids.map(uid=>{
      const person=uid===currentUser.uid?currentProfile:(userProfiles.get(uid)||{});
      const initial=(person.displayName||person.username||"♡").slice(0,1);
      const photo=person.photoURL||"";
      return `<span class="reaction-person ${uid===currentUser.uid?'is-mine':''}" title="${$safe(person.displayName||person.username||'مشارك')}">${photo?`<img src="${$safe(photo)}" alt="" loading="lazy">`:$safe(initial)}</span>`;
    }).join('');
    const mine=uids.includes(currentUser.uid);
    return `<button class="reaction-chip ${mine?'reacted-by-me':''}" data-emoji="${$safe(emoji)}" type="button" aria-label="${$safe(emoji)} تفاعل ${uids.length}"><span class="reaction-emoji">${$safe(emoji)}</span><span class="reaction-people">${people}</span><span class="reaction-count">${uids.length}</span></button>`;
  }).join('');
  el.innerHTML=`${!mine?`<small class="sender-name" style="${nameStyle(sender.id?sender:{color1:senderColor,color2:senderColor})}">${$safe(m.senderName||'صديق')}</small>`:''}${m.pinned?'<div class="pin-mark">📌 مثبتة</div>':''}${reply}${content}<div class="message-meta"><time>${timeOf(m.createdAt)}</time>${m.edited?'<span>تم التعديل</span>':''}</div><div class="reaction-list">${reactions}</div>`;
  const row=document.createElement('div');row.className=`message-row ${mine?'mine':'theirs'}`;row.append(avatar,el);
  if(sender.id||m.senderId){avatar.classList.add("clickable-message-avatar");avatar.setAttribute("role","button");avatar.setAttribute("tabindex","0");const openSender=()=>openPublicProfile(sender.id?sender:(userProfiles.get(m.senderId)||{id:m.senderId,displayName:m.senderName,photoURL:senderPhoto}));avatar.addEventListener("click",openSender);avatar.addEventListener("keydown",e=>{if(e.key==="Enter"||e.key===" "){e.preventDefault();openSender()}})}
  row.querySelectorAll('.reaction-chip').forEach(btn=>btn.onclick=()=>reactTo(m,btn.dataset.emoji));
  row.querySelectorAll('[data-jump]').forEach(btn=>btn.addEventListener('click',()=>jumpToMessage(btn.dataset.jump)));
  beginMessageGestures(row,m,el);
  return row;
}
async function handleMessageAction(action,m,el){
  if(action==='reply'){replyTarget=m;editingId=null;$('replyText').textContent=`رد على ${m.senderName}: ${(m.text||'ملصق').slice(0,90)}`;$('replyPreview').classList.remove('hidden');$('messageInput').focus()}
  if(action==='edit'){if(m.senderId!==currentUser.uid)return;editingId=m.id;replyTarget=null;$('messageInput').value=m.text||'';$('messageInput').focus();toast('عدّل الرسالة ثم اضغط إرسال')}
  if(action==='pin'){try{await updateDoc(doc(db,'threads',activeThreadId(),'messages',m.id),{pinned:!m.pinned,pinnedAt:!m.pinned?serverTimestamp():null});toast(m.pinned?'تم إلغاء التثبيت':'تم تثبيت الرسالة')}catch(error){console.error('Pin message failed:',error);toast('تعذر تغيير تثبيت الرسالة')}}
  if(action==='delete-me'){try{await updateDoc(doc(db,'threads',activeThreadId(),'messages',m.id),{deletedFor:arrayUnion(currentUser.uid)});toast('تم حذف الرسالة من عندك')}catch(error){console.error(error);toast('تعذر حذف الرسالة')}}
  if(action==='delete-all'){if(m.senderId!==currentUser.uid)return toast('حذف لدى الجميع متاح لمرسل الرسالة فقط');try{await updateDoc(doc(db,'threads',activeThreadId(),'messages',m.id),{deletedForAll:true,text:'',deletedAt:serverTimestamp()});toast('تم حذف الرسالة لدى الجميع')}catch(error){console.error(error);toast('تعذر حذف الرسالة لدى الجميع')}}
}
// Jump to a pinned message from the organized pinned strip.
$("pinnedBar").addEventListener("click",event=>{const item=event.target.closest("[data-jump]");if(item)jumpToMessage(item.dataset.jump)});
document.addEventListener("keydown",event=>{if(event.key==="Escape")closeMessageContext()});
async function reactTo(m,emoji){const r=doc(db,"threads",activeThreadId(),"messages",m.id),snap=await getDoc(r),data=snap.data()||{},reactions={...(data.reactions||{})},arr=[...(reactions[emoji]||[])];reactions[emoji]=arr.includes(currentUser.uid)?arr.filter(x=>x!==currentUser.uid):[...arr,currentUser.uid];await updateDoc(r,{reactions});}
$("messageForm").addEventListener("submit",async e=>{e.preventDefault();const input=$("messageInput"),text=input.value.trim();if(!text||!activeChat)return;const tid=activeThreadId();try{if(editingId){await updateDoc(doc(db,"threads",tid,"messages",editingId),{text,edited:true,editedAt:serverTimestamp()});editingId=null}else{const payload={text,senderId:currentUser.uid,senderName:currentProfile.displayName||currentProfile.username,senderColor:colorOf(currentProfile),senderPhotoURL:currentProfile.photoURL||"",createdAt:serverTimestamp()};if(replyTarget)payload.replyTo={id:replyTarget.id,text:replyTarget.text||"ملصق",sticker:replyTarget.sticker||"",senderName:replyTarget.senderName||"صديق"};playSound("messageSound");const sent=await addDoc(collection(db,"threads",tid,"messages"),payload);notifyRecipients(tid,sent.id)}input.value="";input.style.height="auto";replyTarget=null;$("replyPreview").classList.add("hidden");await updateDoc(doc(db,"threads",tid),{updatedAt:serverTimestamp()})}catch(err){console.error(err);toast("تعذر حفظ الرسالة. راجع قواعد Firestore")}});
$("chatSearchToggle")?.addEventListener("click",()=>{const panel=$("chatSearchPanel");const opening=panel.classList.contains("hidden");panel.classList.toggle("hidden",!opening);closeChatToolsMenu();if(opening){requestAnimationFrame(()=>$("chatSearchInput").focus());}else{$("chatSearchInput").value="";filterChatSearch();}});
$("chatSearchClose")?.addEventListener("click",()=>{$("chatSearchPanel").classList.add("hidden");$("chatSearchInput").value="";filterChatSearch();$("chatSearchToggle")?.focus();});
function filterChatSearch(){
  const q=$("chatSearchInput")?.value.trim().toLocaleLowerCase("ar")||"";
  const matches=q?activeMessagesCache.filter(m=>(m.text||"").toLocaleLowerCase("ar").includes(q)):[];
  $("chatSearchCount").textContent=q?`${matches.length}`:"";
  const ids=new Set(matches.map(m=>m.id));
  document.querySelectorAll("#messages .message-row").forEach(row=>row.classList.toggle("search-hidden",!!q&&!ids.has(row.querySelector(".message")?.id.replace("message-",""))));
}
$("chatSearchInput")?.addEventListener("input",filterChatSearch);
$("cancelReply").onclick=()=>{replyTarget=null;$("replyPreview").classList.add("hidden")};
$("stickerBtn").onclick=()=>{const tray=$("stickerTray");const opening=tray.classList.contains("hidden");tray.classList.toggle("hidden",!opening);if(opening)renderStickerTray()};
function startSharedStickerListener(){if(stopSharedStickers)stopSharedStickers();stopSharedStickers=onSnapshot(query(collection(db,"stickers"),orderBy("createdAt","asc")),snapshot=>{sharedStickers=snapshot.docs.map(d=>({id:d.id,...d.data()}));if(!$("stickerTray").classList.contains("hidden"))renderStickerTray()},error=>{console.warn("Shared stickers listener failed:",error);toast("تعذر تحميل الستيكرات المشتركة")});}
function renderStickerTray(){
 const tray=$("stickerTray"),allStickers=[...STICKERS,...sharedStickers.map(s=>({src:s.url,label:s.label||"ستيكر جديد"}))];
 tray.innerHTML=`<div class="sticker-grid"><button class="sticker-add-tile" id="addStickerTile" type="button" aria-label="إضافة ستيكر"><span>＋</span><small>إضافة</small></button>${allStickers.map((s,i)=>`<button class="sticker-pick-tile" data-sticker="${i}" type="button" aria-label="${$safe(s.label||"ستيكر")}"><img src="${$safe(s.src)}" alt="${$safe(s.label||"ستيكر")}" loading="lazy"></button>`).join("")}</div>`;
 $("addStickerTile").onclick=()=>{$("stickerUploadInput").value="";$("stickerUploadInput").click()};
 tray.querySelectorAll("[data-sticker]").forEach(b=>b.onclick=async()=>{const sticker=allStickers[Number(b.dataset.sticker)].src;try{const tid=activeThreadId();const sent=await addDoc(collection(db,"threads",tid,"messages"),{sticker,senderId:currentUser.uid,senderName:currentProfile.displayName||currentProfile.username,senderColor:colorOf(currentProfile),senderPhotoURL:currentProfile.photoURL||"",createdAt:serverTimestamp(),...(replyTarget?{replyTo:{id:replyTarget.id,text:replyTarget.text||"ملصق",sticker:replyTarget.sticker||"",senderName:replyTarget.senderName||"صديق"}}:{})});notifyRecipients(tid,sent.id);tray.classList.add("hidden")}catch(e){console.error(e);toast("تعذر إرسال الملصق")}});
}
$("stickerUploadInput").addEventListener("change",async e=>{
 const file=e.target.files?.[0];if(!file)return;
 if(!file.type.startsWith("image/")&&!/\.gif$/i.test(file.name)){toast("اختاري صورة أو GIF فقط");return;}
 if(file.size>5*1024*1024){toast("حجم الستيكر لازم يكون 5MB أو أقل");return;}
 const addButton=$("addStickerTile");if(addButton){addButton.disabled=true;addButton.innerHTML="<span>…</span><small>جاري الرفع</small>";}
 try{const url=await uploadStickerToCloudinary(file);await addDoc(collection(db,"stickers"),{url,label:file.name.replace(/\.[^.]+$/,"").slice(0,40)||"ستيكر",mediaType:(file.type==="image/gif"||/\.gif$/i.test(file.name))?"gif":"image",uid:currentUser.uid,createdAt:serverTimestamp()});toast("اتضاف الستيكر عند الكل ♡");renderStickerTray();}
 catch(err){console.error(err);toast(err.message||"تعذر إضافة الستيكر. راجعي إعدادات الرفع وقواعد Firestore");if(addButton){addButton.disabled=false;addButton.innerHTML="<span>＋</span><small>إضافة</small>";}}
});
async function uploadStickerToCloudinary(file){const fd=new FormData();fd.append("file",file);fd.append("upload_preset",CLOUDINARY_UPLOAD_PRESET);fd.append("folder","chat-assets/stickers");const response=await fetch(`https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD_NAME}/image/upload`,{method:"POST",body:fd});const data=await response.json();if(!response.ok||!data.secure_url)throw new Error(data?.error?.message||"فشل رفع الستيكر");return data.secure_url;}
$("pinnedToggle").onclick=()=>{$("pinnedBar").classList.toggle("hidden");closeChatToolsMenu()};
function closeChatToolsMenu(){const menu=$("chatToolsMenu"),toggle=$("chatToolsToggle");menu?.classList.add("hidden");toggle?.setAttribute("aria-expanded","false")}
$("chatToolsToggle")?.addEventListener("click",event=>{event.stopPropagation();const menu=$("chatToolsMenu"),opening=menu.classList.contains("hidden");menu.classList.toggle("hidden",!opening);$("chatToolsToggle").setAttribute("aria-expanded",String(opening))});
document.addEventListener("click",event=>{if(!event.target.closest(".chat-tools-wrap"))closeChatToolsMenu()});
document.addEventListener("keydown",event=>{if(event.key==="Escape")closeChatToolsMenu()});
function openGroupSettings(){
  if(!activeChat||activeChat.kind!=="group")return;
  $("groupNameInput").value=activeGroupMeta.name||"S.T.M 🌷";$("groupPhotoInput").value="";$("groupBannerInput").value="";
  const photoPreview=$("groupPhotoPreview");photoPreview.innerHTML=activeGroupMeta.photoURL?`<img src="${$safe(activeGroupMeta.photoURL)}" alt="">`:'♡';
  const bannerPreview=$("groupBannerPreview");bannerPreview.style.backgroundImage=activeGroupMeta.bannerURL?`url("${$safe(activeGroupMeta.bannerURL)}")`:"none";bannerPreview.innerHTML=activeGroupMeta.bannerURL?"":"<span>غلاف الجروب</span>";
  $("groupSettingsError").textContent="";renderGroupMembers();$("groupSettingsModal").classList.remove("hidden");
}
function renderGroupMembers(){
  const list=$("groupMembersList");if(!list)return;
  const isAdmin=activeGroupMeta.admins.includes(currentUser.uid)||currentProfile?.username?.toLowerCase()==="tuqa";
  list.innerHTML=GROUP.participants.map(uid=>{const person=userProfiles.get(uid)||{},admin=activeGroupMeta.admins.includes(uid),label=person.displayName||person.username||"عضو",photo=person.photoURL;return `<div class="group-member-row"><span class="group-member-avatar">${photo?`<img src="${$safe(photo)}" alt="">`:$safe(label.slice(0,1))}</span><span class="group-member-identity"><strong>${$safe(label)}</strong><small>${admin?"مسؤول المجموعة":"عضو"}</small></span>${isAdmin&&uid!==currentUser.uid?`<button type="button" data-role-uid="${$safe(uid)}">${admin?"إزالة المسؤول":"تعيين مسؤول"}</button>`:`<small class="group-role-pill">${admin?"مسؤول":"عضو"}</small>`}</div>`}).join("");
  list.querySelectorAll("[data-role-uid]").forEach(button=>button.addEventListener("click",()=>{const uid=button.dataset.roleUid;activeGroupMeta.admins=activeGroupMeta.admins.includes(uid)?activeGroupMeta.admins.filter(x=>x!==uid):[...activeGroupMeta.admins,uid];renderGroupMembers();}));
}
$("closeGroupSettings")?.addEventListener("click",()=>$("groupSettingsModal").classList.add("hidden"));
$("saveGroupSettings")?.addEventListener("click",async()=>{
  const isAdmin=activeGroupMeta.admins.includes(currentUser.uid)||currentProfile?.username?.toLowerCase()==="tuqa";
  if(!isAdmin){$("groupSettingsError").textContent="إعدادات الجروب متاحة للأدمن فقط.";return;}
  const name=$("groupNameInput").value.trim();if(!name){$("groupSettingsError").textContent="اكتب اسمًا للجروب.";return;}
  const button=$("saveGroupSettings");button.disabled=true;
  try{const admins=[...new Set(activeGroupMeta.admins)],photoFile=$("groupPhotoInput").files?.[0],bannerFile=$("groupBannerInput").files?.[0];
    if(photoFile&&(!photoFile.type.startsWith("image/")||photoFile.size>5*1024*1024))throw new Error("صورة الجروب لازم تكون صورة وأقل من 5MB");
    if(bannerFile&&(!bannerFile.type.startsWith("image/")||bannerFile.size>5*1024*1024))throw new Error("بنر الجروب لازم يكون صورة وأقل من 5MB");
    const photoURL=photoFile?await uploadAvatarToCloudinary(photoFile):activeGroupMeta.photoURL||"";
    const bannerURL=bannerFile?await uploadAvatarToCloudinary(bannerFile):activeGroupMeta.bannerURL||"";
    await updateDoc(doc(db,"threads",GROUP_ID),{groupName:name,groupPhotoURL:photoURL,groupBannerURL:bannerURL,admins,updatedAt:serverTimestamp()});activeGroupMeta={...activeGroupMeta,name,photoURL,bannerURL,admins};$("chatName").textContent=name;renderChatAvatar(activeChat);refreshGroupSidebar();$("groupSettingsModal").classList.add("hidden");toast("تم حفظ تفاصيل الجروب ♡");}
  catch(error){console.error(error);$("groupSettingsError").textContent="تعذر الحفظ. تأكد من تحديث قواعد Firestore.";}
  finally{button.disabled=false;}
});
function renderDecorationGallery(){
  const gallery=$("decorationGallery");if(!gallery)return;
  const selected=String($("decorationSelect").value||"");
  gallery.innerHTML=[{id:"",label:"بدون"},...[1,2,3,4].map(id=>({id:String(id),label:`${id}`}))].map(item=>
    `<button type="button" class="decoration-choice ${selected===item.id?'is-selected':''}" data-decoration="${item.id}" aria-label="${item.id?`اختيار الديكوريشن ${item.id}`:'بدون ديكوريشن'}">${item.id?`<img src="${decorationUrl(item.id)}" alt="">`:'<span class="no-decoration-icon">＋</span>'}<small>${item.label}</small></button>`
  ).join('');
  gallery.querySelectorAll('[data-decoration]').forEach(button=>button.addEventListener('click',()=>{
    $("decorationSelect").value=button.dataset.decoration;
    updateProfileCustomizationPreview();
  }));
}
function updateProfileCustomizationPreview(){
  const name=$("displayNameInput"),c1=$("profileColor").value,c2=$("profileColor2").value;
  if(name){const p={color1:c1,color2:c2,nameFont:$("nameFontSelect").value};$("profileNamePreview").style.cssText=nameStyle(p);$("profileNamePreview").textContent=name.value||"Cute";}
  const deco=$("decorationSelect").value;
  $("profileAvatarPreview").style.backgroundImage=avatarGradient();
  $("editorDecoration").innerHTML=deco?`<img src="${decorationUrl(deco)}" alt="">`:"";
  $("profileAvatarPreview").classList.toggle('has-decoration',!!deco);
  renderDecorationGallery();
}
function applyColorPair(c1,c2){$("profileColor").value=c1;$("profileColor2").value=c2;updateProfileCustomizationPreview();}
["profileColor","profileColor2","nameFontSelect","decorationSelect","displayNameInput"].forEach(id=>$(id)?.addEventListener("input",updateProfileCustomizationPreview));
document.querySelectorAll(".preset-colors [data-pair]").forEach(btn=>btn.addEventListener("click",()=>{const [a,b]=btn.dataset.pair.split(",");applyColorPair(a,b)}));
// Custom font menu: avoids the oversized native Android select sheet.
(()=>{const select=$("nameFontSelect");if(!select||select.dataset.customized)return;select.dataset.customized="1";select.classList.add("font-native-hidden");const wrap=document.createElement("div");wrap.className="font-menu-wrap";const trigger=document.createElement("button");trigger.type="button";trigger.className="font-menu-trigger";trigger.setAttribute("aria-expanded","false");const panel=document.createElement("div");panel.className="font-menu-panel hidden";const refresh=()=>{const opt=select.options[select.selectedIndex];trigger.innerHTML=`<span>${$safe(opt?.text||"واضح")}</span><i>⌄</i>`;panel.querySelectorAll("button").forEach(b=>b.classList.toggle("selected",b.dataset.value===select.value));};[...select.options].forEach(opt=>{const b=document.createElement("button");b.type="button";b.dataset.value=opt.value;b.textContent=opt.text;b.style.fontFamily=({noto:"Noto Sans",arabic:"Noto Sans Arabic",serif:"Noto Serif","arabic-serif":"Noto Naskh Arabic",mono:"Noto Sans Mono",kufi:"Noto Kufi Arabic"})[opt.value]||"inherit";b.onclick=()=>{select.value=opt.value;select.dispatchEvent(new Event("input",{bubbles:true}));refresh();panel.classList.add("hidden");trigger.setAttribute("aria-expanded","false")};panel.appendChild(b)});trigger.onclick=()=>{const opening=panel.classList.contains("hidden");panel.classList.toggle("hidden",!opening);trigger.setAttribute("aria-expanded",String(opening))};wrap.append(trigger,panel);select.insertAdjacentElement("afterend",wrap);refresh();})();
$("profileBtn").onclick=()=>{
  $("displayNameInput").value=currentProfile.displayName||currentProfile.username;
  $("profileBioInput").value=currentProfile.bio||"";
  renderProfileBannerPreview(currentProfile.bannerURL);
  $("profileColor").value=currentProfile.color1||currentProfile.color||colorOf(currentProfile);
  $("profileColor2").value=currentProfile.color2||currentProfile.color1||currentProfile.color||colorOf(currentProfile);

  $("nameFontSelect").value=currentProfile.nameFont||"default";$("decorationSelect").value=String(currentProfile.decoration||"");
  const avatar=$("profileAvatarPreview");avatar.innerHTML=currentProfile.photoURL?`<img src="${$safe(currentProfile.photoURL)}" alt="">`:(currentProfile.displayName||currentProfile.username||"♡").slice(0,1);
  updateProfileCustomizationPreview();loadMyStories();selectedBannerFile=null;selectedAvatarFile=null;$("storyCaptionInput").value="";$("storyFileName").textContent="لم يتم اختيار ملف";$("storyFile").value="";$("storyCompose").classList.add("hidden");
  $("profileModal").classList.remove("hidden");
};
$("closeProfile").onclick=()=>$("profileModal").classList.add("hidden");
$("avatarFile").onchange=e=>{selectedAvatarFile=e.target.files[0];if(selectedAvatarFile){const url=URL.createObjectURL(selectedAvatarFile);$("profileAvatarPreview").innerHTML=`<img src="${url}" alt="">`}};
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
function renderProfileBannerPreview(url){const preview=$("profileBannerStage");if(!preview)return;preview.style.backgroundImage=url?`url("${String(url).replaceAll('"','').replaceAll("\\",'')}")`:"none";preview.innerHTML=url?"":"<span>غلاف ملفك الشخصي</span>";}
$("profileForm").onsubmit=async e=>{e.preventDefault();const displayName=$("displayNameInput").value.trim();if(!displayName)return;const saveButton=$("profileForm").querySelector('button[type="submit"]');const oldButtonText=saveButton.textContent;saveButton.disabled=true;saveButton.textContent="جاري الحفظ...";$("profileError").textContent="";try{let photoURL=currentProfile.photoURL||"",bannerURL=currentProfile.bannerURL||"";if(selectedAvatarFile){if(selectedAvatarFile.size>3*1024*1024)throw new Error("حجم الصورة أكبر من 3MB");if(!selectedAvatarFile.type.startsWith("image/"))throw new Error("اختاري ملف صورة صالح");photoURL=await uploadAvatarToCloudinary(selectedAvatarFile)}if(selectedBannerFile){if(selectedBannerFile.size>5*1024*1024||!selectedBannerFile.type.startsWith("image/"))throw new Error("البنر لازم يكون صورة أقل من 5MB");bannerURL=await uploadAvatarToCloudinary(selectedBannerFile)}const patch={displayName,color:$("profileColor").value,color1:$("profileColor").value,color2:$("profileColor2").value,nameFont:$("nameFontSelect").value,decoration:$("decorationSelect").value,photoURL,bannerURL,bio:$("profileBioInput").value.trim()};await updateDoc(doc(db,"users",currentUser.uid),patch);currentProfile={...currentProfile,...patch};userProfiles.set(currentUser.uid,currentProfile);renderMe();await loadContacts();$("profileModal").classList.add("hidden");selectedAvatarFile=null;selectedBannerFile=null;toast("اتحفظ ملفك الشخصي ♡")}catch(err){console.error(err);$("profileError").textContent=err.message||"تعذر حفظ الملف. تأكدي من إعدادات Cloudinary وقواعد Firestore."}finally{saveButton.disabled=false;saveButton.textContent=oldButtonText}};

// Public profiles: open a contact's profile from the active chat header.
$("chatAvatar").style.cursor="pointer";$("chatName").style.cursor="pointer";
$("chatAvatar").addEventListener("click",()=>{if(!activeChat)return;if(activeChat.kind==="group")openGroupSettings();else openPublicProfile(userProfiles.get(activeChat.id)||activeChat)});
$("chatName").addEventListener("click",()=>{if(!activeChat)return;if(activeChat.kind==="group")openGroupSettings();else openPublicProfile(userProfiles.get(activeChat.id)||activeChat)});
$("groupPhotoInput")?.addEventListener("change",e=>{const file=e.target.files?.[0];if(file){const url=URL.createObjectURL(file);$("groupPhotoPreview").innerHTML=`<img src="${url}" alt="">`}});
$("groupBannerInput")?.addEventListener("change",e=>{const file=e.target.files?.[0];if(file){const url=URL.createObjectURL(file);const preview=$("groupBannerPreview");preview.style.backgroundImage=`url("${url}")`;preview.innerHTML=""}});
$("closePublicProfile").onclick=()=>$("publicProfileModal").classList.add("hidden");
let viewedStory=null;
async function loadMyStories(){const list=$("myStoriesList");if(!list||!currentUser)return;list.innerHTML="<small>جاري تحميل حالاتك...</small>";try{const snap=await getDocs(collection(db,"stories"));const stories=snap.docs.map(d=>({id:d.id,...d.data()})).filter(x=>x.uid===currentUser.uid&&Number(x.expiresAt||0)>Date.now()).sort((a,b)=>(b.createdAt?.toMillis?.()||0)-(a.createdAt?.toMillis?.()||0));list.innerHTML="";if(!stories.length){list.innerHTML="<small class='profile-hint'>مفيش حالات نشطة عندك حاليًا.</small>";return;}stories.forEach(story=>{const wrap=document.createElement("div");wrap.className="my-story-item";const open=document.createElement("button");open.type="button";open.className="my-story-open";open.textContent=story.mediaType==="image"?"📷 صورة":story.mediaType==="video"?"▶ فيديو":(story.caption||"حالة نصية").slice(0,32);open.onclick=()=>showStory(story);const del=document.createElement("button");del.type="button";del.className="my-story-delete";del.textContent="حذف";del.onclick=async()=>{if(!confirm("تمسح الحالة دي؟"))return;try{await deleteDoc(doc(db,"stories",story.id));toast("اتمسحت الحالة");loadMyStories();}catch(e){console.error(e);toast("تعذر حذف الحالة. راجع قواعد Firestore")}};wrap.append(open,del);list.appendChild(wrap)});}catch(e){console.error(e);list.innerHTML="<small>تعذر تحميل حالاتك.</small>"}}
async function openPublicProfile(profile){
  if(!profile)return;const modal=$("publicProfileModal");$("publicProfileName").textContent=profile.displayName||profile.username||"مستخدم";$("publicProfileName").style.cssText=nameStyle(profile);$("publicProfileDecoration").innerHTML=profile.decoration?`<img src="${decorationUrl(profile.decoration)}" alt="">`:"";
  $("publicProfileStatus").textContent=profile.statusText||presenceInfo(profile).text;$("publicProfileBio").textContent=profile.bio||"لا توجد نبذة تعريفية بعد.";
  const banner=$("publicProfileBanner");banner.style.height="150px";banner.style.backgroundImage=profile.bannerURL?`url("${profile.bannerURL.replaceAll('"','').replaceAll("\\",'')}")`:profileGradient(profile);
  const avatar=$("publicProfileAvatar");avatar.innerHTML=profile.photoURL?`<img src="${$safe(profile.photoURL)}" alt="">`:$safe((profile.displayName||profile.username||"♡").slice(0,1));avatar.style.width=avatar.style.height="104px";avatar.style.backgroundImage=avatarGradient(profile);avatar.classList.toggle('has-decoration',!!profile.decoration);
  const list=$("publicStoriesItems");list.innerHTML="<span class='profile-hint'>جاري تحميل الحالات...</span>";modal.classList.remove("hidden");
  try{const snap=await getDocs(collection(db,"stories"));const stories=snap.docs.map(d=>({id:d.id,...d.data()})).filter(x=>x.uid===profile.id&&Number(x.expiresAt||0)>Date.now()).sort((a,b)=>(b.createdAt?.toMillis?.()||0)-(a.createdAt?.toMillis?.()||0));list.innerHTML="";if(!stories.length){list.innerHTML="<span class='profile-hint'>لا توجد حالات نشطة حاليًا.</span>";return;}stories.forEach(story=>{const b=document.createElement("button");b.type="button";b.className="story-thumb";b.innerHTML=story.mediaType==="video"?`<span>▶ فيديو</span>`:story.mediaType==="image"?`<img src="${$safe(story.mediaUrl)}" alt="حالة">`:`<span>نص ✦</span>`;b.onclick=()=>showStory(story);list.appendChild(b);});}
  catch(e){console.warn("Stories load failed",e);list.innerHTML="<span class='profile-hint'>تعذر تحميل الحالات. راجع قواعد Firestore.</span>";}
}
function showStory(story){viewedStory=story;$("deleteViewedStory").classList.toggle("hidden",story.uid!==currentUser.uid);const holder=$("storyViewerMedia");holder.innerHTML=story.mediaType==="video"?`<video src="${$safe(story.mediaUrl)}" controls autoplay playsinline></video>`:story.mediaType==="image"?`<img src="${$safe(story.mediaUrl)}" alt="الحالة">`:`<div class="story-text-card">${$safe(story.caption||"")}</div>`;$("storyViewerCaption").textContent=story.mediaType==="text"?"":(story.caption||"");let reply=$("storyPrivateReply");if(!reply){reply=document.createElement("form");reply.id="storyPrivateReply";reply.className="story-private-reply";reply.innerHTML='<input id="storyReplyInput" maxlength="1000" placeholder="أرسل شيئًا..."><button type="submit">إرسال</button>';$("storyViewer").querySelector(".story-viewer-card").appendChild(reply);reply.addEventListener("submit",sendStoryPrivateReply)}reply.classList.toggle("hidden",story.uid===currentUser.uid);$("storyReplyInput").value="";$("storyViewer").classList.remove("hidden");}
async function sendStoryPrivateReply(event){event.preventDefault();if(!viewedStory||viewedStory.uid===currentUser.uid)return;const input=$("storyReplyInput"),text=input.value.trim();if(!text)return;try{let owner=userProfiles.get(viewedStory.uid);if(!owner){const ownerSnap=await getDoc(doc(db,"users",viewedStory.uid));if(ownerSnap.exists()){owner={id:viewedStory.uid,...ownerSnap.data()};userProfiles.set(viewedStory.uid,owner)}}if(!owner)throw new Error("تعذر العثور على صاحب الحالة");const tid=threadId(currentUser.uid,viewedStory.uid);const threadRef=doc(db,"threads",tid);await setDoc(threadRef,{kind:"direct",participants:[currentUser.uid,viewedStory.uid].sort(),participantNames:[currentProfile.username,owner.username],createdAt:serverTimestamp(),updatedAt:serverTimestamp()},{merge:true});const sent=await addDoc(collection(db,"threads",tid,"messages"),{text,senderId:currentUser.uid,senderName:currentProfile.displayName||currentProfile.username,senderColor:colorOf(currentProfile),senderPhotoURL:currentProfile.photoURL||"",createdAt:serverTimestamp(),storyReply:{storyId:viewedStory.id,caption:viewedStory.caption||"",mediaType:viewedStory.mediaType||"text"}});await updateDoc(threadRef,{updatedAt:serverTimestamp()});notifyRecipients(tid,sent.id);input.value="";toast("اترسل تعليقك في الخاص لصاحب الحالة ♡")}catch(error){console.error(error);toast("تعذر إرسال التعليق. تأكد من وجود محادثة أو صلاحيات Firestore")}}
$("closeStoryViewer").onclick=()=>{$("storyViewerMedia").innerHTML="";$("storyViewer").classList.add("hidden");viewedStory=null};
$("deleteViewedStory").onclick=async()=>{if(!viewedStory||viewedStory.uid!==currentUser.uid)return;if(!confirm("متأكد إنك عايز تمسح الحالة؟"))return;try{await deleteDoc(doc(db,"stories",viewedStory.id));$("storyViewer").classList.add("hidden");$("storyViewerMedia").innerHTML="";viewedStory=null;toast("تم حذف الحالة");loadMyStories();}catch(e){console.error(e);toast("تعذر حذف الحالة. راجع قواعد Firestore")}};
let cropSource=null,cropScale=1,cropX=0,cropY=0,cropDrag=null,cropBaseW=0,cropBaseH=0;
function layoutBannerCrop(){if(!cropSource)return;const box=$("bannerCropViewport"),img=$("bannerCropImage"),w=box.clientWidth,h=box.clientHeight;const fit=Math.max(w/cropSource.width,h/cropSource.height);cropBaseW=cropSource.width*fit;cropBaseH=cropSource.height*fit;cropScale=Number($("bannerCropZoom").value)||1;cropX=0;cropY=0;drawBannerCrop();}
function drawBannerCrop(){const img=$("bannerCropImage"),box=$("bannerCropViewport");if(!img||!box)return;const w=cropBaseW*cropScale,h=cropBaseH*cropScale;const maxX=Math.max(0,(w-box.clientWidth)/2),maxY=Math.max(0,(h-box.clientHeight)/2);cropX=Math.max(-maxX,Math.min(maxX,cropX));cropY=Math.max(-maxY,Math.min(maxY,cropY));img.style.width=`${w}px`;img.style.height=`${h}px`;img.style.left=`50%`;img.style.top=`50%`;img.style.transform=`translate(calc(-50% + ${cropX}px),calc(-50% + ${cropY}px))`;}
function openBannerCrop(file){if(!file||!file.type.startsWith('image/'))return toast('اختار صورة صالحة للبنر');const url=URL.createObjectURL(file),img=new Image();img.onload=()=>{cropSource=img;$("bannerCropImage").src=url;$("bannerCropZoom").value='1';$("bannerCropModal").classList.remove('hidden');requestAnimationFrame(layoutBannerCrop)};img.onerror=()=>{URL.revokeObjectURL(url);toast('تعذر فتح الصورة')};img.src=url;}
function closeBannerCrop(){ $("bannerCropModal").classList.add('hidden');if(cropSource?.src?.startsWith('blob:'))URL.revokeObjectURL(cropSource.src);cropSource=null;$("bannerFile").value=''; }
$("bannerFile").onchange=e=>{const file=e.target.files?.[0];if(file)openBannerCrop(file)};
$("bannerCropZoom").addEventListener('input',()=>{const old=cropScale;cropScale=Number($("bannerCropZoom").value)||1;if(old) {cropX*=cropScale/old;cropY*=cropScale/old}drawBannerCrop()});
$("bannerCropViewport").addEventListener('pointerdown',e=>{if(!cropSource)return;cropDrag={x:e.clientX,y:e.clientY,ox:cropX,oy:cropY};e.currentTarget.setPointerCapture(e.pointerId)});
$("bannerCropViewport").addEventListener('pointermove',e=>{if(!cropDrag)return;cropX=cropDrag.ox+(e.clientX-cropDrag.x);cropY=cropDrag.oy+(e.clientY-cropDrag.y);drawBannerCrop()});
["pointerup","pointercancel","lostpointercapture"].forEach(n=>$("bannerCropViewport").addEventListener(n,()=>cropDrag=null));
["cancelBannerCrop","cancelBannerCrop2"].forEach(id=>$(id).addEventListener('click',closeBannerCrop));
$("confirmBannerCrop").addEventListener('click',()=>{if(!cropSource)return;const box=$("bannerCropViewport"),out=document.createElement('canvas'),ctx=out.getContext('2d'),vw=box.clientWidth,vh=box.clientHeight;out.width=1500;out.height=500;const scale=cropBaseW*cropScale/vw,sourcePerScreen=cropSource.width/(cropBaseW*cropScale);const sw=vw*sourcePerScreen,sh=vh*sourcePerScreen,sx=(cropSource.width-sw)/2-cropX*sourcePerScreen,sy=(cropSource.height-sh)/2-cropY*sourcePerScreen;ctx.drawImage(cropSource,Math.max(0,sx),Math.max(0,sy),Math.min(sw,cropSource.width),Math.min(sh,cropSource.height),0,0,out.width,out.height);out.toBlob(blob=>{if(!blob)return toast('تعذر تجهيز صورة البنر');selectedBannerFile=new File([blob],'bubble-banner.jpg',{type:'image/jpeg'});renderProfileBannerPreview(URL.createObjectURL(selectedBannerFile));$("bannerCropModal").classList.add('hidden');if(cropSource?.src?.startsWith('blob:'))URL.revokeObjectURL(cropSource.src);cropSource=null;toast('تم تحديد صورة البنر ♡')},'image/jpeg',.9)});
window.addEventListener('resize',()=>{if(cropSource&&!$("bannerCropModal").classList.contains('hidden'))layoutBannerCrop()});
$("addStoryBtn").onclick=()=>$("storyCompose").classList.toggle("hidden");
document.querySelectorAll("[data-story-type]").forEach(button=>button.addEventListener("click",()=>{const type=button.dataset.storyType;$("storyFile").value="";if(type==="text"){ $("storyFileName").textContent="حالة نصية";$("storyCaptionInput").focus();return;}$("storyFile").accept=type==="image"?"image/*":"video/*";$("storyFile").click();}));
$("storyFile").onchange=e=>{const f=e.target.files?.[0];$("storyFileName").textContent=f?f.name:"لم يتم اختيار ملف";};
$("publishStoryBtn").onclick=async()=>{
 const file=$("storyFile").files?.[0]||null,caption=$("storyCaptionInput").value.trim();
 if(!file&&!caption)return toast("اكتب نص الحالة أو اختار صورة / فيديو");
 const button=$("publishStoryBtn");button.disabled=true;button.textContent="جاري النشر...";
 try{
  let mediaUrl="",mediaType="text";
  if(file){const isVideo=file.type.startsWith("video/");if(!file.type.startsWith("image/")&&!isVideo)throw new Error("اختار صورة أو فيديو صالح");if(file.size>(isVideo?25:8)*1024*1024)throw new Error("حجم الملف أكبر من المسموح");if(isVideo&&await getVideoDuration(file)>30)throw new Error("مدة الفيديو لازم تكون 30 ثانية أو أقل");mediaUrl=await uploadStoryToCloudinary(file,isVideo);mediaType=isVideo?"video":"image";}
  await addDoc(collection(db,"stories"),{uid:currentUser.uid,displayName:currentProfile.displayName||currentProfile.username,mediaUrl,mediaType,caption,createdAt:serverTimestamp(),expiresAt:Date.now()+24*60*60*1000});
  toast("تم نشر حالتك لمدة 24 ساعة ♡");loadMyStories();$("storyCaptionInput").value="";$("storyFile").value="";$("storyFileName").textContent="لم يتم اختيار ملف";
 }catch(err){console.error(err);toast(err.message||"تعذر نشر الحالة");}finally{button.disabled=false;button.textContent="نشر الحالة";}
};
function getVideoDuration(file){return new Promise((resolve,reject)=>{const video=document.createElement("video"),url=URL.createObjectURL(file);video.preload="metadata";video.onloadedmetadata=()=>{const duration=video.duration;URL.revokeObjectURL(url);resolve(duration);};video.onerror=()=>{URL.revokeObjectURL(url);reject(new Error("تعذر قراءة مدة الفيديو"));};video.src=url;});}
async function uploadStoryToCloudinary(file,isVideo){const fd=new FormData();fd.append("file",file);fd.append("upload_preset",CLOUDINARY_UPLOAD_PRESET);fd.append("folder","chat-assets/stories");const endpoint=isVideo?"video":"image";const response=await fetch(`https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD_NAME}/${endpoint}/upload`,{method:"POST",body:fd});const data=await response.json();if(!response.ok||!data.secure_url)throw new Error(data?.error?.message||"فشل رفع الحالة");return data.secure_url;}


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
  const dockItems = $("sidebarMiniItems");
  const syncSidebarMiniDock = () => {
    if (!dockItems) return;
    const contactsRoot = $("contacts");
    if (!contactsRoot) return;
    const contacts = [...contactsRoot.querySelectorAll(".contact")].slice(0, 3);
    dockItems.innerHTML = "";
    contacts.forEach(contact => {
      const shortcut = document.createElement("button");
      shortcut.type = "button";
      shortcut.className = "sidebar-mini-contact";
      const name = contact.querySelector("strong")?.textContent?.trim() || "فتح المحادثة";
      const thread = contact.dataset.threadId || "";
      const unread = unreadCounts.get(thread) || 0;
      const presence = contact.querySelector(".presence-dot");
      const presenceText = presence?.title || contact.querySelector(".contact-status")?.textContent?.trim() || "جروب";
      shortcut.title = unread ? `${name} · ${unread} رسالة جديدة · ${presenceText}` : `${name} · ${presenceText}`;
      shortcut.setAttribute("aria-label", shortcut.title);
      shortcut.innerHTML = contact.innerHTML;
      if (contact.classList.contains("selected")) shortcut.classList.add("is-selected");
      if (unread > 0) {
        const unreadDot = document.createElement("span");
        unreadDot.className = "mini-message-dot";
        unreadDot.textContent = unread > 9 ? "9+" : String(unread);
        unreadDot.setAttribute("aria-label", `${unread} رسالة جديدة`);
        shortcut.appendChild(unreadDot);
        shortcut.classList.add("has-new-message");
      }
      shortcut.addEventListener("click", () => contact.click());
      dockItems.appendChild(shortcut);
    });
  };
  const contactsDockObserver = new MutationObserver(syncSidebarMiniDock);
  const contactsDockRoot = $("contacts");
  if (contactsDockRoot) contactsDockObserver.observe(contactsDockRoot, {childList:true,subtree:true,attributes:true,attributeFilter:["class"]});
  syncSidebarMiniDock();
  const applySidebarState = (isCollapsed) => {
    chatLayout.classList.toggle("sidebar-collapsed", isCollapsed);
    updateCollapsedUnreadIndicator();
    syncSidebarMiniDock();
    window.__bubbleSyncMiniDock = syncSidebarMiniDock;
    sidebarToggle.textContent = isCollapsed ? "⌃" : "‹";
    sidebarToggle.setAttribute("aria-expanded", String(!isCollapsed));
    sidebarToggle.setAttribute("aria-label", isCollapsed ? "إظهار الشريط الجانبي" : "إخفاء الشريط الجانبي");
    sidebarToggle.title = isCollapsed ? "إظهار الشريط الجانبي" : "إخفاء الشريط الجانبي";
    localStorage.setItem("bubble-chat-sidebar-collapsed", String(isCollapsed));
  };
  applySidebarState(collapsed);
  sidebarToggle.addEventListener("click", () => {
    applySidebarState(!chatLayout.classList.contains("sidebar-collapsed"));
  });
  $("collapsedUnreadIndicator")?.addEventListener("click",()=>applySidebarState(false));
  $("sidebarDockToggle")?.addEventListener("click",()=>applySidebarState(false));
}

// Mobile keyboard handling: resize only the chat content area, never scroll the whole page/header away.
(function setupKeyboardViewport(){const vv=window.visualViewport;if(!vv)return;const update=()=>{const keyboard=Math.max(0,window.innerHeight-vv.height-vv.offsetTop);document.documentElement.style.setProperty("--keyboard-inset",keyboard+"px");document.body.classList.toggle("keyboard-open",keyboard>120)};vv.addEventListener("resize",update);vv.addEventListener("scroll",update);window.addEventListener("orientationchange",()=>setTimeout(update,250));update()})();
