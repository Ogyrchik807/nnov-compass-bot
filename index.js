export default {
  async fetch(request, env) {
    try {
      const url = new URL(request.url);
      const path = url.pathname;
      const BOT_TOKEN = env.BOT_TOKEN;
      const STATS = env.STATS_KV;

      // --- ДАШБОРД (отдельная страница) ---
      if (path === '/dashboard') {
        return await showDashboard(STATS);
      }

      // --- Обработка вебхука ---
      if (path === '/webhook') {
        const update = await request.json();

        // Обработка callback-запросов (для кнопок языка)
        if (update.callback_query) {
          const callback = update.callback_query;
          const chatId = callback.message.chat.id;
          const data = callback.data;

          if (data === 'lang_en') {
            userLanguage[chatId] = 'en';
            await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                chat_id: chatId,
                text: '✅ Language changed to English!',
                parse_mode: 'Markdown'
              })
            });
          } else if (data === 'lang_ru') {
            userLanguage[chatId] = 'ru';
            await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                chat_id: chatId,
                text: '✅ Язык изменён на Русский!',
                parse_mode: 'Markdown'
              })
            });
          }

          return new Response('OK', { status: 200 });
        }

        if (update.message) {
          const chatId = update.message.chat.id;
          const text = update.message.text || '';
          const location = update.message.location;
          let replyText = '';
          let replyKeyboard = null;
          let sendPhoto = false;
          let photoUrl = '';

          // --- ЗАПИСЬ СТАТИСТИКИ ---
          await recordStats(STATS, chatId, text, location);

          // --- ПОЛУЧАЕМ ЯЗЫК ПОЛЬЗОВАТЕЛЯ ---
          const lang = userLanguage[chatId] || 'en';
          const t = TEXTS[lang];

          // --- Команда /language ---
          if (text === '/language') {
            replyText = t.language_prompt;
            replyKeyboard = {
              inline_keyboard: [
                [{ text: '🇬🇧 English', callback_data: 'lang_en' }],
                [{ text: '🇷🇺 Русский', callback_data: 'lang_ru' }]
              ]
            };
          }
          // --- Команда /start ---
          else if (text === '/start') {
            replyText = t.start;
            replyKeyboard = {
              keyboard: [
                [{ text: '📍 Send Location', request_location: true }],
                [{ text: '❓ Help' }]
              ],
              resize_keyboard: true,
              one_time_keyboard: false
            };
          }
          // --- Команда /help ---
          else if (text === '/help' || text === '❓ Help') {
            replyText = t.help;
          }
          // --- Команда /locations ---
          else if (text === '/locations') {
            replyText = formatLandmarksList(lang);
          }
          // --- Команда /about ---
          else if (text === '/about') {
            replyText = t.about;
          }
          // --- Обработка геолокации ---
          else if (location) {
            const userLat = location.latitude;
            const userLon = location.longitude;
            const nearest = findNearestLandmark(userLat, userLon, lang);

            if (nearest) {
              // --- ЗАПИСЫВАЕМ ПОПУЛЯРНОСТЬ МЕСТА ---
              await recordLandmarkStat(STATS, nearest.name);

              const distanceText = lang === 'ru' ? 'Расстояние' : 'Distance';
              const coordsText = lang === 'ru' ? 'Координаты' : 'Coordinates';
              const mapsText = lang === 'ru' ? 'Открыть в Google Maps' : 'Open in Google Maps';

              replyText = 
`📍 *${nearest.name}*

${nearest.description}

📏 *${distanceText}:* ${nearest.distance.toFixed(1)} km
📍 *${coordsText}:* ${nearest.lat}, ${nearest.lon}

🗺️ *${mapsText}:* [Click here](https://www.google.com/maps?q=${nearest.lat},${nearest.lon})`;

              if (nearest.image) {
                sendPhoto = true;
                photoUrl = nearest.image;
              }
            } else {
              replyText = t.no_landmarks;
            }
          }
          // --- Неизвестная команда ---
          else {
            replyText = t.unknown;
          }

          // --- Единая отправка ответа ---
          if (replyText) {
            const payload = {
              chat_id: chatId,
              text: replyText,
              parse_mode: 'Markdown',
              disable_web_page_preview: true
            };

            if (replyKeyboard) {
              payload.reply_markup = JSON.stringify(replyKeyboard);
            }

            if (sendPhoto && photoUrl) {
              await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendPhoto`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  chat_id: chatId,
                  photo: photoUrl,
                  caption: replyText,
                  parse_mode: 'Markdown'
                })
              });
            } else {
              await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
              });
            }
          }
        }

        return new Response('OK', { status: 200 });
      }

      return new Response('Bot is running!', { status: 200 });

    } catch (e) {
      console.error('Error:', e);
      return new Response('Server Error', { status: 500 });
    }
  }
};

// --- 📊 ФУНКЦИИ ДЛЯ СТАТИСТИКИ ---

async function recordStats(STATS, chatId, text, location) {
  try {
    // Считаем уникальных пользователей
    const users = await STATS.get('users', 'json') || [];
    if (!users.includes(chatId)) {
      users.push(chatId);
      await STATS.put('users', JSON.stringify(users));
    }

    // Считаем команды
    let starts = parseInt(await STATS.get('starts') || '0');
    let geos = parseInt(await STATS.get('geos') || '0');

    if (text === '/start') starts++;
    if (location) geos++;

    await STATS.put('starts', starts.toString());
    await STATS.put('geos', geos.toString());
  } catch (e) {
    console.error('Stats error:', e);
  }
}

async function recordLandmarkStat(STATS, landmarkName) {
  try {
    // Получаем текущий счётчик для этого места
    const key = `landmark_${landmarkName}`;
    const count = parseInt(await STATS.get(key) || '0');
    await STATS.put(key, (count + 1).toString());
  } catch (e) {
    console.error('Landmark stat error:', e);
  }
}

// --- 📈 ДАШБОРД ---

async function showDashboard(STATS) {
  try {
    // Собираем данные
    const users = await STATS.get('users', 'json') || [];
    const starts = parseInt(await STATS.get('starts') || '0');
    const geos = parseInt(await STATS.get('geos') || '0');

    // Топ-5 мест
    const landmarks = LANDMARKS.map(l => l.name.en).slice(0, 5);
    const topPlaces = [];
    for (const name of landmarks) {
      const count = parseInt(await STATS.get(`landmark_${name}`) || '0');
      topPlaces.push({ name, count });
    }
    topPlaces.sort((a, b) => b.count - a.count);

    // HTML страница дашборда
    const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Bot Dashboard</title>
  <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
  <style>
    body {
      font-family: system-ui, sans-serif;
      background: #0a0a0f;
      color: #e0e0ff;
      padding: 20px;
    }
    .container { max-width: 800px; margin: 0 auto; }
    .stats-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
      gap: 20px;
      margin-bottom: 30px;
    }
    .stat-card {
      background: #161b22;
      padding: 20px;
      border-radius: 12px;
      text-align: center;
      border: 1px solid #30363d;
    }
    .stat-number { font-size: 2.5rem; font-weight: bold; color: #58a9ff; }
    .stat-label { font-size: 0.9rem; color: #8b949e; }
    .chart-container {
      background: #161b22;
      padding: 20px;
      border-radius: 12px;
      border: 1px solid #30363d;
      margin-bottom: 20px;
    }
    h1 { font-size: 1.8rem; margin-bottom: 10px; }
    p { color: #8b949e; }
    a { color: #58a9ff; text-decoration: none; }
    a:hover { text-decoration: underline; }
  </style>
</head>
<body>
  <div class="container">
    <h1>📊 Cultural Compass — Analytics</h1>
    <p>Real-time statistics for your bot</p>

    <div class="stats-grid">
      <div class="stat-card">
        <div class="stat-number">${users.length}</div>
        <div class="stat-label">👤 Total Users</div>
      </div>
      <div class="stat-card">
        <div class="stat-number">${starts}</div>
        <div class="stat-label">🚀 /start commands</div>
      </div>
      <div class="stat-card">
        <div class="stat-number">${geos}</div>
        <div class="stat-label">📍 Geolocation requests</div>
      </div>
    </div>

    <div class="chart-container">
      <h3>🏆 Top 5 Landmarks</h3>
      <canvas id="topChart"></canvas>
    </div>

    <p>🔗 <a href="https://t.me/nnov_compass_bot">Open Bot</a></p>
    <p style="font-size:0.8rem; color:#484f58;">Data updated in real-time from Cloudflare KV</p>
  </div>

  <script>
    const ctx = document.getElementById('topChart').getContext('2d');
    new Chart(ctx, {
      type: 'bar',
      data: {
        labels: ${JSON.stringify(topPlaces.map(p => p.name))},
        datasets: [{
          label: 'Searches',
          data: ${JSON.stringify(topPlaces.map(p => p.count))},
          backgroundColor: '#58a9ff',
          borderColor: '#58a9ff',
          borderWidth: 0,
          borderRadius: 6,
        }]
      },
      options: {
        responsive: true,
        plugins: {
          legend: { display: false }
        },
        scales: {
          y: { beginAtZero: true, ticks: { color: '#8b949e' } },
          x: { ticks: { color: '#8b949e' } }
        }
      }
    });
  </script>
</body>
</html>`;

    return new Response(html, {
      headers: { 'Content-Type': 'text/html' }
    });
  } catch (e) {
    console.error('Dashboard error:', e);
    return new Response('Error loading dashboard', { status: 500 });
  }
}

// --- 🌐 ЯЗЫКОВЫЕ НАСТРОЙКИ ---
const userLanguage = {};

const TEXTS = {
  'en': {
    start: `🏛️ *Welcome to the Nizhny Novgorod Cultural Compass!*

I'm your guide to the most fascinating landmarks in my hometown. Send me your *location* 📍, and I'll find the nearest place of interest for you.

You can also:
• Use /help to see available commands
• Explore the city's rich history and architecture

Let's start our journey! 🚀`,
    help: `📖 *Available Commands:*

/start - Start the bot and see the main menu
/help - Show this help message
/locations - See a list of all landmarks
/about - Learn about this project
/language - Change language

📍 *Send your location* to find the nearest landmark.`,
    about: `🤖 *About the Cultural Compass Bot*

This bot was created as a personal project to showcase my skills in software engineering and to share the beauty of Nizhny Novgorod.

*Technologies:* Cloudflare Workers, JavaScript, Telegram Bot API

*Author:* Komarov Sergey
*Purpose:* US college applications portfolio`,
    unknown: `🤔 I didn't understand that command. Please use /start to see the main menu or /help for a list of commands.`,
    language_prompt: `🌐 *Choose your language:*
    
🇬🇧 English
🇷🇺 Русский

Please select your language:`,
    no_landmarks: `😔 Sorry, I couldn't find any landmarks near you. Try sending your location again or use /start to see the main menu.`,
    list_title: '🗺️ *List of all landmarks in Nizhny Novgorod:*'
  },
  'ru': {
    start: `🏛️ *Добро пожаловать в Культурный компас Нижнего Новгорода!*

Я ваш гид по самым интересным достопримечательностям моего родного города. Отправьте мне свою *геолокацию* 📍, и я найду ближайшее место, которое стоит посетить.

Вы также можете:
• Использовать /help, чтобы увидеть список команд
• Изучить богатую историю и архитектуру города

Начнём наше путешествие! 🚀`,
    help: `📖 *Доступные команды:*

/start - Запустить бота и увидеть главное меню
/help - Показать это сообщение
/locations - Список всех достопримечательностей
/about - Узнать о проекте
/language - Сменить язык

📍 *Отправьте геолокацию*, чтобы найти ближайшую достопримечательность.`,
    about: `🤖 *О боте "Культурный компас"*

Этот бот был создан как личный проект для демонстрации моих навыков в разработке и чтобы поделиться красотой Нижнего Новгорода.

*Технологии:* Cloudflare Workers, JavaScript, Telegram Bot API

*Автор:* Комаров Сергей
*Цель:* Портфолио для поступления в вузы США`,
    unknown: `🤔 Я не понял эту команду. Используйте /start, чтобы увидеть главное меню, или /help для списка команд.`,
    language_prompt: `🌐 *Выберите язык:*
    
🇬🇧 English
🇷🇺 Русский

Пожалуйста, выберите язык:`,
    no_landmarks: `😔 К сожалению, я не нашёл достопримечательностей рядом с вами. Попробуйте отправить геолокацию снова или используйте /start, чтобы увидеть главное меню.`,
    list_title: '🗺️ *Список всех достопримечательностей Нижнего Новгорода:*'
  }
};

// --- 📍 БАЗА ДАННЫХ ДОСТОПРИМЕЧАТЕЛЬНОСТЕЙ ---
const LANDMARKS = [
  {
    name: {
      en: 'Nizhny Novgorod Kremlin',
      ru: 'Нижегородский кремль'
    },
    lat: 56.3287,
    lon: 44.0020,
    description: {
      en: 'The main fortress of the city, founded in 1508. One of the best-preserved medieval fortresses in Russia.',
      ru: 'Главная крепость города, основанная в 1508 году. Одна из наиболее хорошо сохранившихся средневековых крепостей России.'
    },
    image: 'https://upload.wikimedia.org/wikipedia/commons/2/23/Night_view_of_a_tower_of_the_Nizhny_Novgorod_Kremlin%2C_Russia.jpg'
  },
  {
    name: {
      en: 'Chkalov Stairs',
      ru: 'Чкаловская лестница'
    },
    lat: 56.330890,
    lon: 44.009448,
    description: {
      en: 'A famous staircase shaped like a figure eight, leading down to the Volga River. Built in 1943.',
      ru: 'Знаменитая лестница в форме восьмёрки, ведущая к реке Волге. Построена в 1943 году.'
    },
    image: 'https://avatars.mds.yandex.net/i?id=a4d547d749fae0a372cfeab07631d132_l-7882711-images-thumbs&n=13'
  },
  {
    name: {
      en: 'Christmas (Rozhdestvenskaya) Church',
      ru: 'Рождественская церковь'
    },
    lat: 56.327306,
    lon: 43.984992,
    description: {
      en: 'One of the most beautiful churches in Nizhny Novgorod, located at the confluence of the Oka and Volga rivers.',
      ru: 'Одна из красивейших церквей Нижнего Новгорода, расположенная при слиянии рек Оки и Волги.'
    },
    image: 'https://i2020.otzovik.com/2020/06/18/10219183/img/997274_78197388.jpeg'
  },
  {
    name: {
      en: 'Nizhny Novgorod Fair',
      ru: 'Нижегородская ярмарка'
    },
    lat: 56.32839171063699,
    lon: 43.961235738303515,
    description: {
      en: 'The site of the largest fair in the Russian Empire in the 19th century.',
      ru: 'Место проведения крупнейшей ярмарки Российской империи в XIX веке.'
    },
    image: 'https://avatars.mds.yandex.net/i?id=25c4a23ed526d674609db3581d2194bf_l-10268218-images-thumbs&n=13'
  },
  {
    name: {
      en: 'Bolshaya Pokrovskaya Street',
      ru: 'Улица Большая Покровская'
    },
    lat: 56.317088,
    lon: 43.994829,
    description: {
      en: 'The main pedestrian street of Nizhny Novgorod, lined with historic buildings and cafes.',
      ru: 'Главная пешеходная улица Нижнего Новгорода с историческими зданиями и кафе.'
    },
    image: 'https://upload.wikimedia.org/wikipedia/commons/7/7a/Bolshaya_Pokrovskaya_Street%2C_Nizhny_Novgorod.jpg'
  },
  {
    name: {
      en: 'Rukavishnikov Estate Museum',
      ru: 'Усадьба Рукавишникова'
    },
    lat: 56.326289,
    lon: 44.001542,
    description: {
      en: 'A magnificent 19th-century mansion of the Rukavishnikov family, now a museum.',
      ru: 'Великолепный особняк XIX века семьи Рукавишниковых, ныне музей.'
    },
    image: 'https://avatars.mds.yandex.net/i?id=256bd2f473442013e3628c4386ff2d400076b683-8000127-images-thumbs&n=13'
  },
  {
    name: {
      en: 'Church of St. John the Baptist',
      ru: 'Церковь Иоанна Предтечи'
    },
    lat: 56.329747,
    lon: 43.998089,
    description: {
      en: 'One of the oldest Orthodox churches in Nizhny Novgorod, mentioned from the 15th century.',
      ru: 'Одна из старейших православных церквей Нижнего Новгорода, упоминается с XV века.'
    },
    image: 'https://avatars.mds.yandex.net/i?id=9525744d47686c5136d49fdbe65aa0ef_l-10272338-images-thumbs&n=13'
  },
  {
    name: {
      en: 'Church of the Nativity of John the Baptist',
      ru: 'Церковь Рождества Иоанна Предтечи'
    },
    lat: 56.329792,
    lon: 43.998142,
    description: {
      en: 'A historic church located on Rozhdestvenskaya Street with beautiful 17th-century architecture.',
      ru: 'Историческая церковь на Рождественской улице с прекрасной архитектурой XVII века.'
    },
    image: 'https://avatars.mds.yandex.net/i?id=91266355409338d1d0bc66e0ca500778_l-16110730-images-thumbs&n=13'
  },
  {
    name: {
      en: 'Monument to Maxim Gorky',
      ru: 'Памятник Максиму Горькому'
    },
    lat: 56.324337,
    lon: 43.983498,
    description: {
      en: 'A bronze monument to the great Russian writer Maxim Gorky, created in 1957.',
      ru: 'Бронзовый памятник великому русскому писателю Максиму Горькому, созданный в 1957 году.'
    },
    image: 'https://yastatic.net/naydex/yandex-search/7aimWE113/9f0c5fELaZXl/V_lcw-wcdTDPScfAL7S6qI94auWCnZHO3LjkQSaHEWcs1E8UnT55Npe06tpGhWcjSO1PdkYyvZhVjE40fMpxpMVKv_DK31eC2TolQi5k-8wvyb9AU74zc'
  },
  {
    name: {
      en: 'Monument to the Heroes of the Volga Flotilla',
      ru: 'Памятник героям Волжской военной флотилии'
    },
    lat: 56.329040,
    lon: 43.988403,
    description: {
      en: 'A monument commemorating the feat of the sailors of the Volga Military Flotilla.',
      ru: 'Памятник, увековечивающий подвиг моряков Волжской военной флотилии.'
    },
    image: 'https://avatars.mds.yandex.net/get-entity_search/122335/162670577/S600xU_2x'
  }
];

// --- 🌐 ФУНКЦИЯ ДЛЯ СПИСКА ВСЕХ МЕСТ ---
function formatLandmarksList(lang) {
  const t = TEXTS[lang] || TEXTS['en'];
  let list = t.list_title + '\n\n';
  LANDMARKS.forEach((place, index) => {
    const name = place.name[lang] || place.name.en;
    const description = place.description[lang] || place.description.en;
    list += `${index + 1}. *${name}*\n`;
    list += `   📍 ${place.lat}, ${place.lon}\n`;
    list += `   ${description}\n\n`;
  });
  list += '📍 ' + (lang === 'ru' ? 'Отправьте геолокацию, и я найду ближайшую!' : 'Send me your location 📍, and I\'ll find the nearest one!');
  return list;
}

// --- 🧮 ФУНКЦИЯ ДЛЯ РАСЧЁТА РАССТОЯНИЯ ---
function haversine(lat1, lon1, lat2, lon2) {
  const toRad = (value) => value * Math.PI / 180;
  const R = 6371;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
            Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

// --- 📍 ФУНКЦИЯ ПОИСКА БЛИЖАЙШЕГО МЕСТА ---
function findNearestLandmark(userLat, userLon, lang) {
  let nearest = null;
  let minDistance = Infinity;

  for (const landmark of LANDMARKS) {
    const distance = haversine(userLat, userLon, landmark.lat, landmark.lon);
    if (distance < minDistance) {
      minDistance = distance;
      nearest = {
        ...landmark,
        name: landmark.name[lang] || landmark.name.en,
        description: landmark.description[lang] || landmark.description.en,
        distance: distance
      };
    }
  }

  return nearest;
}
