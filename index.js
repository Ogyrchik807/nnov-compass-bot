export default {
  async fetch(request, env) {
    try {
      const url = new URL(request.url);
      const path = url.pathname;
      const BOT_TOKEN = env.BOT_TOKEN;

      // --- Обработка вебхука ---
      if (path === '/webhook') {
        const update = await request.json();

        if (update.message) {
          const chatId = update.message.chat.id;
          const text = update.message.text || '';
          const location = update.message.location;
          let replyText = '';
          let replyKeyboard = null;

          // --- Команда /start ---
          if (text === '/start') {
            replyText = 
`🏛️ *Welcome to the Nizhny Novgorod Cultural Compass!*

I'm your guide to the most fascinating landmarks in my hometown. Send me your *location* 📍, and I'll find the nearest place of interest for you.

You can also:
• Use /help to see available commands
• Explore the city's rich history and architecture

Let's start our journey! 🚀`;
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
            replyText = 
`📖 *Available Commands:*

/start - Start the bot and see the main menu
/help - Show this help message
/locations - See a list of all landmarks
/about - Learn about this project

📍 *Send your location* to find the nearest landmark.`;
          }
          // --- Команда /locations ---
          else if (text === '/locations') {
            replyText = formatLandmarksList();
          }
          // --- Команда /about ---
          else if (text === '/about') {
            replyText = 
`🤖 *About the Cultural Compass Bot*

This bot was created as a personal project to showcase my skills in software engineering and to share the beauty of Nizhny Novgorod.

*Technologies:* Cloudflare Workers, JavaScript, Telegram Bot API

*Author:* Komarov Sergey
*Purpose:* US college applications portfolio

*GitHub:* [Link to your repo]`;
          }
          // --- Обработка геолокации ---
          else if (location) {
            const userLat = location.latitude;
            const userLon = location.longitude;
            const nearest = findNearestLandmark(userLat, userLon);

            if (nearest) {
              replyText = 
`📍 *${nearest.name}*

${nearest.description}

📏 *Distance:* ${nearest.distance.toFixed(1)} km
📍 *Coordinates:* ${nearest.lat}, ${nearest.lon}

🗺️ *Open in Google Maps:* [Click here](https://www.google.com/maps?q=${nearest.lat},${nearest.lon})`;
            } else {
              replyText = '😔 Sorry, I couldn\'t find any landmarks near you. Try sending your location again or use /start to see the main menu.';
            }
          }
          // --- Неизвестная команда ---
          else {
            replyText = 
`🤔 I didn't understand that command. Please use /start to see the main menu or /help for a list of commands.`;
          }

          // --- Отправка ответа ---
          const payload = {
            chat_id: chatId,
            text: replyText,
            parse_mode: 'Markdown',
            disable_web_page_preview: true
          };

          if (replyKeyboard) {
            payload.reply_markup = JSON.stringify(replyKeyboard);
          }

          await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
          });
        }

        return new Response('OK', { status: 200 });
      }

      // --- Корневой путь (для проверки) ---
      return new Response('Bot is running!', { status: 200 });

    } catch (e) {
      console.error('Error:', e);
      return new Response('Server Error', { status: 500 });
    }
  }
};

// --- 📍 БАЗА ДАННЫХ ДОСТОПРИМЕЧАТЕЛЬНОСТЕЙ ---
const LANDMARKS = [
  {
    name: 'Nizhny Novgorod Kremlin',
    lat: 56.3287,
    lon: 44.0020,
    description: 'The main fortress of the city, founded in 1508. It is one of the best-preserved medieval fortresses in Russia, with 13 towers and stunning views of the Volga and Oka rivers.'
  },
  {
    name: 'Chkalov Stairs',
    lat: 56.330890,
    lon: 44.009448,
    description: 'A famous staircase shaped like a figure eight, leading down to the Volga River. Built in 1943, it offers a magnificent panoramic view of the river and the city.'
  },
  {
    name: 'Christmas (Rozhdestvenskaya) Church',
    lat: 56.327306,
    lon: 43.984992,
    description: 'One of the most beautiful churches in Nizhny Novgorod, located at the confluence of the Oka and Volga rivers. Built in the 17th century, it features stunning Russian Orthodox architecture.'
  },
  {
    name: 'Nizhny Novgorod Fair',
    lat: 56.32839171063699,
    lon: 43.961235738303515,
    description: 'The site of the largest fair in the Russian Empire in the 19th century. The main building is a magnificent example of classical architecture and now hosts various events.'
  },
  {
    name: 'Bolshaya Pokrovskaya Street',
    lat: 56.317088,
    lon: 43.994829,
    description: 'The main pedestrian street of Nizhny Novgorod, lined with historic buildings, shops, cafes, and street musicians. The heart of the city\'s cultural life.'
  },
  {
    name: 'Rukavishnikov Estate Museum',
    lat: 56.329312,
    lon: 44.016083,
    description: 'A magnificent 19th-century mansion of the Rukavishnikov family, now a museum. It showcases the luxurious lifestyle of the local nobility with beautifully preserved interiors.'
  }
];

// --- 🌐 ФУНКЦИЯ ДЛЯ СПИСКА ВСЕХ МЕСТ ---
function formatLandmarksList() {
  let list = '🗺️ *List of all landmarks in Nizhny Novgorod:*\n\n';
  LANDMARKS.forEach((place, index) => {
    list += `${index + 1}. *${place.name}*\n`;
    list += `   📍 ${place.lat}, ${place.lon}\n`;
    list += `   ${place.description}\n\n`;
  });
  list += 'Send me your location 📍, and I\'ll find the nearest one!';
  return list;
}

// --- 🧮 ФУНКЦИЯ ДЛЯ РАСЧЁТА РАССТОЯНИЯ (формула гаверсинусов) ---
function haversine(lat1, lon1, lat2, lon2) {
  const toRad = (value) => value * Math.PI / 180;
  const R = 6371; // Радиус Земли в км

  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
            Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

// --- 📍 ФУНКЦИЯ ПОИСКА БЛИЖАЙШЕГО МЕСТА ---
function findNearestLandmark(userLat, userLon) {
  let nearest = null;
  let minDistance = Infinity;

  for (const landmark of LANDMARKS) {
    const distance = haversine(userLat, userLon, landmark.lat, landmark.lon);
    if (distance < minDistance) {
      minDistance = distance;
      nearest = {
        ...landmark,
        distance: distance
      };
    }
  }

  return nearest;
}
