const $ = (id) => document.getElementById(id);
const music = $('backgroundMusic');
const musicToggle = $('musicToggle');
const musicToggleLabel = $('musicToggleLabel');
const intro = $('intro');
const site = $('site');
const floatLayer = $('floatLayer');
const sparkles = $('sparkles');
let musicWasChosen = false;
let foundSecrets = new Set();
let toastTimer;

music.volume = 0.18;
for (let i = 0; i < 48; i++) {
  const dot = document.createElement('span');
  dot.className = 'sparkle';
  dot.style.left = `${Math.random() * 100}%`;
  dot.style.top = `${Math.random() * 100}%`;
  dot.style.setProperty('--duration', `${3 + Math.random() * 6}s`);
  dot.style.setProperty('--delay', `${Math.random() * 7}s`);
  dot.style.setProperty('--shine', `${0.12 + Math.random() * 0.38}`);
  sparkles.appendChild(dot);
}

function toast(text) {
  const el = $('toast');
  el.textContent = text;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2600);
}
function burst(items = ['💗','♡','✨','💖'], count = 18) {
  for (let i = 0; i < count; i++) {
    const el = document.createElement('span');
    el.className = 'floating-emoji';
    el.textContent = items[Math.floor(Math.random() * items.length)];
    el.style.left = `${Math.random() * 100}%`;
    el.style.setProperty('--dur', `${2.2 + Math.random() * 2.5}s`);
    el.style.setProperty('--size', `${14 + Math.random() * 22}px`);
    floatLayer.appendChild(el);
    setTimeout(() => el.remove(), 5000);
  }
}
function confetti() {
  const pieces = ['♡','✦','💗','✨','🎀','💌'];
  for (let i = 0; i < 34; i++) {
    const el = document.createElement('span');
    el.className = 'confetti';
    el.textContent = pieces[Math.floor(Math.random() * pieces.length)];
    el.style.left = `${Math.random() * 100}%`;
    el.style.setProperty('--dur', `${2 + Math.random() * 3}s`);
    el.style.fontSize = `${12 + Math.random() * 18}px`;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 5200);
  }
}
function updateMusicButton() {
  const playing = !music.paused;
  musicToggleLabel.textContent = playing ? 'وقفي الموسيقى' : 'شغّلي الموسيقى';
  musicToggle.classList.toggle('is-playing', playing);
  musicToggle.setAttribute('aria-pressed', String(playing));
}
async function toggleMusic() {
  musicWasChosen = true;
  if (music.paused) {
    try { await music.play(); toast('المزيكا اشتغلت.. يلا نعيش الدور 🎶'); }
    catch { toast('حطي ملف music.mp3 جنب ملفات الموقع عشان المزيكا تشتغل 🎵'); }
  } else music.pause();
  updateMusicButton();
}
musicToggle.addEventListener('click', toggleMusic);
music.addEventListener('play', updateMusicButton);
music.addEventListener('pause', updateMusicButton);

$('enterBtn').addEventListener('click', () => {
  intro.classList.add('hidden');
  site.classList.remove('hidden');
  window.scrollTo({ top: 0, behavior: 'smooth' });
  burst(['💗','✨','🫶','♡','😭'], 30);
  if (!musicWasChosen) music.play().catch(() => {});
  setTimeout(() => toast('أهلًا بيكي في المصيبة.. دوسي على كل حاجة 😂'), 500);
});

$('inlineSecret').addEventListener('click', (e) => {
  const secret = $('secretMessage');
  secret.classList.toggle('hidden');
  e.currentTarget.textContent = secret.classList.contains('hidden') ? 'افتحيها لو قلبك جامد 😂' : 'اقفلي السر قبل ما اعيط 😭';
  if (!secret.classList.contains('hidden')) burst(['💗','🫂','✨'], 12);
});

const roasts = [
  'يا فضولية اهمدي بقى 😂',
  'مبروك! كسبتي لقب: اكتر واحدة بتدوس على أي حاجة من غير ما تقرأ 😂',
  'الزرار ده كان بيقولك متدوسيش.. بس واضح إن الغباء وراثي 😭😂',
  'تقرير رسمي: نسبة الهبل فيا تخطت المعدلات العالمية. ربنا يستر.',
  'تم سحب رخصة العقل لمدة 3 ثواني. تقدري ترجعي تكملي هبل دلوقتي.',
  'انتي مش فضولية انتي الأمن السبراني بنفسه 😂',
  'مفيش حاجة حصلت.. بس شكرًا على دعمك النفسي للزرار 😂',
  'اعتراف: إحنا حاطين الزرار ده عشان نضحك على اللي هيدوسوا عليه. أهلًا بيكي.'
];
$('roastBtn').addEventListener('click', () => {
  $('resultBox').textContent = roasts[Math.floor(Math.random() * roasts.length)];
  burst(['😂','🧨','✨'], 8);
});

const gifts = [
  '🎁 مبروك! كسبتي حضن كبير أوي 🫂❤️',
  'الجايزة: لا شيء خالص. شكرًا لمشاركتك في المسابقة 😂',
  '💌 رسالة من القلب: انتي غالية ومكانك محفوظ حتى لو بتجيبي الضغط.',
  'يا بنتي انتي داخلة الصندوق ده على امل تلاقي ايه بالظبط 😂',
  '✨ أمنية صغيرة ليكي: ربنا يطمن قلبك ويفرحك بحاجة نفسك فيها.',
  '🐍 الصندوق بيقولك بطلي فضول.. وبعدين افتحيه تاني يمكن تلاقي حاجة.',
  '🫶 افتكري إنك اجمل واحدة في الدنيا، حتى في الأيام اللي مش حاسة فيها بكده.',
  '😭 فيه حد هنا ممتن إنك في حياته.. ايوه انتي يا بتاعة الفضول.'
];
$('giftBtn').addEventListener('click', () => {
  $('resultBox').textContent = gifts[Math.floor(Math.random() * gifts.length)];
  burst(['🎁','💗','🎀','✨'], 14);
});

const secretMessages = {
  1: 'سر صغير: حتى رسايلكم العادية بتسيب أثر حلو في يومي، حتى لو هي مجرد «بصي بقى» وبعدها مصيبة 😂💗',
  2: 'اعتراف خطير: ساعات بفتح الشات عشان أطمن عليكم حتى لو مش هقول إني داخلة أطمن. أهو بنعمل نفسنا جامدين 😭🫂',
  3: 'رسالة الساعة 3: لو انتي صاحيه دلوقتي نامي يا بنتي، ولو مش عارفة تنامي فأتمنى قلبك يهدى وتفتكري إن بكرة هيبقى ألطف 💗',
  4: 'من غير هزار: أنا فعلًا ممتنة إنكم بقيتوا جزء من حياتي. مش لازم اقولها كل يوم عشان تفضل حقيقة. بحبكم يا بنات قلبي 🫶'
};
document.querySelectorAll('.secret-card').forEach(card => card.addEventListener('click', () => {
  const id = card.dataset.secret;
  $('resultBox').textContent = secretMessages[id];
  if (!foundSecrets.has(id)) {
    foundSecrets.add(id);
    $('secretCount').textContent = foundSecrets.size;
    card.classList.add('found');
    card.querySelector('small').textContent = 'اتكشف السر ✓';
    if (foundSecrets.size === 4) {
      toast('فتحتي كل الأسرار! خدي احتفال صغير 🎉');
      confetti();
      setTimeout(() => { $('resultBox').textContent += '\n\n🏆 إنجاز جديد: فضولك ملوش علاج. بس بنحبك برضه.'; }, 350);
    }
  }
  burst(['✨','💗','♡'], 7);
}));

const quizQuestions = [
  {q:'مين اكتر واحدة لعيبة؟ 😂', options:['تقى','سماء','منة'], correct:['سماء','منة'], answer:'سماء ومنة وتقى نوبة يا بشررر 😂😭'},
  {q:'مين اكتر واحدة غبية؟ 😂', options:['تقى','سماء','منة'], correct:['سماء'], answer:'سماء 😂😂 تقى ومنة اعفاء يا بشررر😂😂😂😂'},
  {q:'مين اغبى اتنين؟ 😭', options:['تقى وسماء','منة وسماء','تقى ومنة'], correct:['منة وسماء'], answer:'منة وسماء 😭😭 تقى طلعت براءة المرة دي.'},
  {q:'مين اكتر واحدة طيبة وحمارة؟ 💗', options:['تقى','سماء','منة'], correct:['سماء'], answer:'سماء يا حبيبتي 😂💗 طيبة وبيتضحك عليها كمان.'}
];
let quizIndex = 0;
function loadQuiz() {
  const q = quizQuestions[quizIndex % quizQuestions.length];
  $('quizQuestion').textContent = q.q;
  $('quizOptions').replaceChildren();
  q.options.forEach(option => {
    const btn = document.createElement('button');
    btn.textContent = option;
    btn.addEventListener('click', () => {
      const isCorrect = q.correct.includes(option);
      $('quizQuestion').textContent = q.answer;
      $('quizOptions').replaceChildren();
      const next = document.createElement('button');
      next.textContent = quizIndex === quizQuestions.length - 1 ? 'عيدي الاختبار 😂' : 'السؤال اللي بعده ←';
      next.addEventListener('click', () => {
        quizIndex = (quizIndex + 1) % quizQuestions.length;
        loadQuiz();
      });
      $('quizOptions').appendChild(next);
      if (isCorrect) burst(['😂','💗','✨'], 8);
      else burst(['😭','😂'], 5);
    });
    $('quizOptions').appendChild(btn);
  });
}
$('quizBtn').addEventListener('click', () => {
  $('quizPanel').scrollIntoView({behavior:'smooth', block:'center'});
  toast('يلا يا تقى ورينا هتظلمي مين النهارده 😂');
});
loadQuiz();

let gameInterval = null;
let spawnInterval = null;
let score = 0;
let timeLeft = 15;
let gameStarted = false;
function endGame() {
  clearInterval(gameInterval); clearInterval(spawnInterval);
  gameStarted = false;
  $('gameArena').replaceChildren();
  $('gameStatus').textContent = score >= 15 ? `يا نهار أبيض! جمعتي ${score} قلب! انتي فاضية باحتراف 😂💗` : `جمعتي ${score} قلب. أداء مشرف بالنسبة لواحدة بتلعب بإصبع واحد 😂`;
  if (score >= 10) confetti();
}
function spawnHeart() {
  if (!gameStarted) return;
  const heart = document.createElement('button');
  heart.className = 'game-heart';
  heart.textContent = ['💗','💖','💕','❤️'][Math.floor(Math.random() * 4)];
  heart.setAttribute('aria-label','اجمعي القلب');
  heart.style.left = `${Math.random() * 82}%`;
  heart.style.top = `${Math.random() * 76}%`;
  heart.addEventListener('click', () => {
    score++;
    $('score').textContent = score;
    heart.remove();
  });
  $('gameArena').appendChild(heart);
  setTimeout(() => heart.remove(), 1000);
}
function startGame() {
  clearInterval(gameInterval); clearInterval(spawnInterval);
  score = 0; timeLeft = 15; gameStarted = true;
  $('score').textContent = score; $('timeLeft').textContent = timeLeft;
  $('gameStatus').textContent = 'يلااااا بسرعة! 💗';
  $('gameArena').replaceChildren();
  spawnHeart();
  spawnInterval = setInterval(spawnHeart, 520);
  gameInterval = setInterval(() => {
    timeLeft--;
    $('timeLeft').textContent = timeLeft;
    if (timeLeft <= 0) endGame();
  }, 1000);
}
$('heartGameBtn').addEventListener('click', () => {
  $('gameOverlay').classList.remove('hidden');
  startGame();
});
function closeGame() {
  $('gameOverlay').classList.add('hidden');
  clearInterval(gameInterval); clearInterval(spawnInterval); gameStarted = false;
}
$('closeGame').addEventListener('click', closeGame);
$('gameOverlay').addEventListener('click', e => { if (e.target === $('gameOverlay')) closeGame(); });
$('finalBtn').addEventListener('click', () => {
  $('finalMessage').classList.toggle('hidden');
  if (!$('finalMessage').classList.contains('hidden')) { burst(['🫂','💗','✨','♡'], 28); confetti(); $('finalBtn').textContent = 'بحبكم يا بنات قلبي ❤️'; }
});
$('easterEgg').addEventListener('click', () => {
  toast('لقيتي السر الأخير! انتي رسميًا اكتر واحدة فضولية في العيلة 😂🏆');
  burst(['💗','😂','✨','🎀'], 24);
});
// Tiny hidden surprise: tap the hero title three times.
let heroTaps = 0;
document.querySelector('.hero h2').addEventListener('click', () => {
  heroTaps++;
  if (heroTaps >= 3) { heroTaps = 0; toast('لقيتي حاجة مستخبية! قلبك كبير بس فضولك أكبر 😂'); burst(['♡','💗','✨'], 14); }
});
updateMusicButton();


// Open any memory photo at full size when tapped.
const photoLightbox = document.getElementById('photoLightbox');
const fullPhoto = document.getElementById('fullPhoto');
function closePhotoViewer() {
  photoLightbox.classList.add('hidden');
  fullPhoto.src = '';
  document.body.style.overflow = '';
}
document.querySelectorAll('.memory-photo img').forEach(photo => {
  photo.addEventListener('click', () => {
    fullPhoto.src = photo.src;
    fullPhoto.alt = photo.alt || 'الصورة بالحجم الكامل';
    photoLightbox.classList.remove('hidden');
    document.body.style.overflow = 'hidden';
  });
});
document.getElementById('closePhoto').addEventListener('click', closePhotoViewer);
photoLightbox.addEventListener('click', event => { if (event.target === photoLightbox) closePhotoViewer(); });
document.addEventListener('keydown', event => { if (event.key === 'Escape' && !photoLightbox.classList.contains('hidden')) closePhotoViewer(); });
