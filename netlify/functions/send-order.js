/* ============================================================
   send-order.js — серверная функция Netlify
   Принимает заказ со страницы order.html (JSON с контактами
   и PDF-макетом в base64) и отправляет письмо через SMTP
   Haskimail с помощью nodemailer.

   Переменные окружения (задаются в настройках Netlify):
     HASKIMAIL_TOKEN — API-ключ Haskimail (логин и пароль SMTP)
     MAIL_FROM       — адрес отправителя, подтверждённый в Haskimail
                       (необязательно, по умолчанию — адрес получателя)
   ============================================================ */

const nodemailer = require('nodemailer');

// Куда приходят заказы
const RECIPIENT = 'otpechatok2026@mail.ru';

// Максимальная длина текстовых полей — защита от слишком больших данных
const MAX_FIELD_LENGTH = 2000;

// Поля формы и их подписи в письме (в порядке вывода)
const FIELDS = [
  ['product_type', 'Тип товара'],
  ['name',         'Имя'],
  ['phone',        'Телефон'],
  ['email',        'E-mail'],
  ['vk',           'ВКонтакте'],
  ['telegram',     'Telegram'],
  ['max',          'MAX'],
  ['color',        'Цвет футболки'],
  ['size',         'Размер'],
  ['sides',        'Стороны с принтом'],
  ['message',      'Комментарий'],
];

// ── Ответ в формате JSON ──────────────────────────────────────────────────
function json(statusCode, body) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify(body),
  };
}

// ── Привести значение к безопасной строке ограниченной длины ─────────────
function clean(value) {
  if (value === undefined || value === null) return '';
  return String(value).trim().slice(0, MAX_FIELD_LENGTH);
}

// ── Экранирование HTML, чтобы данные клиента не ломали письмо ────────────
function escapeHtml(text) {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

exports.handler = async function (event) {
  // Принимаем только POST
  if (event.httpMethod !== 'POST') {
    return json(405, { ok: false, error: 'Метод не поддерживается' });
  }

  // ── Разбираем тело запроса ─────────────────────────────────────────────
  let data;
  try {
    const raw = event.isBase64Encoded
      ? Buffer.from(event.body || '', 'base64').toString('utf8')
      : (event.body || '');
    data = JSON.parse(raw || '{}');
  } catch (err) {
    return json(400, { ok: false, error: 'Некорректные данные запроса' });
  }

  // Ловушка для ботов: живой человек скрытое поле не заполняет.
  // Отвечаем «успехом», чтобы бот не понял, что его отсеяли.
  if (clean(data['bot-field'])) {
    return json(200, { ok: true });
  }

  // ── Собираем и проверяем поля ──────────────────────────────────────────
  const order = {};
  FIELDS.forEach(([key]) => { order[key] = clean(data[key]); });

  const sides = [];
  if (data.hasFront) sides.push('перед');
  if (data.hasBack)  sides.push('спина');
  order.sides = sides.join(', ') || 'не указано';

  if (order.name.length < 2) {
    return json(400, { ok: false, error: 'Не указано имя' });
  }
  if (!/^[\d\s+\-()]{7,}$/.test(order.phone)) {
    return json(400, { ok: false, error: 'Некорректный телефон' });
  }

  // PDF приходит строкой base64 — проверяем, что это действительно base64
  const pdf = typeof data.pdf === 'string' ? data.pdf.replace(/\s/g, '') : '';
  if (pdf && !/^[A-Za-z0-9+/]+={0,2}$/.test(pdf)) {
    return json(400, { ok: false, error: 'Некорректный PDF-файл' });
  }

  // Ключ берём только из переменной окружения — в коде его быть не должно
  const token = process.env.HASKIMAIL_TOKEN;
  if (!token) {
    console.error('Не задана переменная окружения HASKIMAIL_TOKEN');
    return json(500, { ok: false, error: 'Почта на сервере не настроена' });
  }

  // ── Текст письма ───────────────────────────────────────────────────────
  const rows = FIELDS.map(([key, label]) => [label, order[key] || '—']);

  const text = 'Новый заказ с сайта «Отпечаток»\n\n' +
    rows.map(([label, value]) => `${label}: ${value}`).join('\n') +
    (pdf ? '\n\nМакеты футболки — во вложении (PDF).' : '');

  const html =
    '<h2>Новый заказ с сайта «Отпечаток»</h2>' +
    '<table cellpadding="6" style="border-collapse:collapse;font-family:Arial,sans-serif;font-size:14px">' +
    rows.map(([label, value]) =>
      `<tr><td style="color:#666;vertical-align:top"><b>${escapeHtml(label)}</b></td>` +
      `<td style="white-space:pre-wrap">${escapeHtml(value)}</td></tr>`
    ).join('') +
    '</table>' +
    (pdf ? '<p>Макеты футболки — во вложении (PDF).</p>' : '');

  // ── Подключение к SMTP Haskimail (STARTTLS на порту 587) ───────────────
  const transporter = nodemailer.createTransport({
    host:   'smtp.haskimail.ru',
    port:   587,
    secure: false,
    auth: {
      user: token,
      pass: token,
    },
  });

  // Дата для имени файла, например 2026-10-08
  const date = new Date().toISOString().slice(0, 10);

  try {
    await transporter.sendMail({
      from:    process.env.MAIL_FROM || RECIPIENT,
      to:      RECIPIENT,
      // Если клиент указал e-mail, на письмо можно сразу ответить ему
      replyTo: /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(order.email) ? order.email : undefined,
      subject: `${order.product_type ? '[' + order.product_type + '] ' : ''}Новый заказ: ${order.name}, ${order.phone}`,
      text,
      html,
      attachments: pdf ? [{
        filename:    `order-${date}.pdf`,
        content:     pdf,
        encoding:    'base64',
        contentType: 'application/pdf',
      }] : [],
    });
  } catch (err) {
    console.error('Ошибка отправки письма:', err);
    return json(502, { ok: false, error: 'Не удалось отправить письмо' });
  }

  return json(200, { ok: true });
};
