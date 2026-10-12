<?php
/* ============================================================
   send-order.php — обработчик заказов для хостинга Бегет
   (замена функции netlify/functions/send-order.js)

   Принимает заказ со страницы order.html (JSON с контактами
   и PDF-макетом в base64) и отправляет письмо через SMTP
   Haskimail с помощью PHPMailer.

   Токен Haskimail берётся из переменной окружения
   HASKIMAIL_TOKEN, а если её нет — из файла mail-config.php.
   ============================================================ */

use PHPMailer\PHPMailer\PHPMailer;
use PHPMailer\PHPMailer\Exception;

// PHPMailer подключаем вручную — Composer на shared-хостинге не нужен
require __DIR__ . '/phpmailer/Exception.php';
require __DIR__ . '/phpmailer/PHPMailer.php';
require __DIR__ . '/phpmailer/SMTP.php';

// Куда приходят заказы
const RECIPIENT = 'otpechatok2026@mail.ru';

// Максимальная длина текстовых полей — защита от слишком больших данных
const MAX_FIELD_LENGTH = 2000;

// Максимальный размер PDF после декодирования (15 МБ)
const MAX_PDF_BYTES = 15 * 1024 * 1024;

// Поля формы и их подписи в письме (в порядке вывода)
$FIELDS = [
    'name'     => 'Имя',
    'phone'    => 'Телефон',
    'email'    => 'E-mail',
    'vk'       => 'ВКонтакте',
    'telegram' => 'Telegram',
    'max'      => 'MAX',
    'color'    => 'Цвет футболки',
    'size'     => 'Размер',
    'sides'    => 'Стороны с принтом',
    'message'  => 'Комментарий',
];

// ── Ответ в формате JSON и завершение скрипта ────────────────────────────
function json_response($statusCode, array $body)
{
    http_response_code($statusCode);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode($body, JSON_UNESCAPED_UNICODE);
    exit;
}

// ── Привести значение к безопасной строке ограниченной длины ─────────────
function clean($value)
{
    if ($value === null || is_array($value) || is_object($value)) {
        return '';
    }
    return mb_substr(trim((string) $value), 0, MAX_FIELD_LENGTH, 'UTF-8');
}

// ── Экранирование HTML, чтобы данные клиента не ломали письмо ────────────
function escape_html($text)
{
    return htmlspecialchars($text, ENT_QUOTES, 'UTF-8');
}

// Принимаем только POST
if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    header('Allow: POST');
    json_response(405, ['ok' => false, 'error' => 'Метод не поддерживается']);
}

// ── Разбираем тело запроса ───────────────────────────────────────────────
// Страница присылает JSON; на всякий случай поддерживаем и обычную форму
$raw  = file_get_contents('php://input');
$data = json_decode($raw === false ? '' : $raw, true);
if (!is_array($data)) {
    $data = $_POST;
}
if (empty($data)) {
    // Пустое тело часто означает, что запрос больше лимита post_max_size
    json_response(400, ['ok' => false, 'error' => 'Некорректные данные запроса']);
}

// Ловушка для ботов: живой человек скрытое поле не заполняет.
// Отвечаем «успехом», чтобы бот не понял, что его отсеяли.
if (clean(isset($data['bot-field']) ? $data['bot-field'] : '') !== '') {
    json_response(200, ['ok' => true]);
}

// ── Собираем и проверяем поля ────────────────────────────────────────────
$order = [];
foreach ($FIELDS as $key => $label) {
    $order[$key] = clean(isset($data[$key]) ? $data[$key] : '');
}

$sides = [];
if (!empty($data['hasFront'])) $sides[] = 'перед';
if (!empty($data['hasBack']))  $sides[] = 'спина';
$order['sides'] = $sides ? implode(', ', $sides) : 'не указано';

if (mb_strlen($order['name'], 'UTF-8') < 2) {
    json_response(400, ['ok' => false, 'error' => 'Не указано имя']);
}
if (!preg_match('/^[\d\s+\-()]{7,}$/u', $order['phone'])) {
    json_response(400, ['ok' => false, 'error' => 'Некорректный телефон']);
}

// PDF приходит строкой base64 — проверяем и декодируем
$pdfBinary = '';
if (isset($data['pdf']) && is_string($data['pdf']) && $data['pdf'] !== '') {
    $pdfBase64 = preg_replace('/\s+/', '', $data['pdf']);
    // Строгий режим: при посторонних символах base64_decode вернёт false
    $pdfBinary = base64_decode($pdfBase64, true);
    if ($pdfBinary === false || strncmp($pdfBinary, '%PDF', 4) !== 0) {
        json_response(400, ['ok' => false, 'error' => 'Некорректный PDF-файл']);
    }
    if (strlen($pdfBinary) > MAX_PDF_BYTES) {
        json_response(413, ['ok' => false, 'error' => 'PDF-файл слишком большой']);
    }
}

// ── Настройки почты: переменная окружения или mail-config.php ────────────
$config = [];
if (is_file(__DIR__ . '/mail-config.php')) {
    $config = require __DIR__ . '/mail-config.php';
}
$token = getenv('HASKIMAIL_TOKEN');
if (!$token) {
    $token = isset($config['token']) ? $config['token'] : '';
}
$from = !empty($config['from']) ? $config['from'] : RECIPIENT;

if (!$token || strpos($token, 'ВСТАВЬТЕ') === 0) {
    error_log('send-order.php: не задан токен Haskimail (HASKIMAIL_TOKEN или mail-config.php)');
    json_response(500, ['ok' => false, 'error' => 'Почта на сервере не настроена']);
}

// ── Текст письма ─────────────────────────────────────────────────────────
$textRows = [];
$htmlRows = '';
foreach ($FIELDS as $key => $label) {
    $value = $order[$key] !== '' ? $order[$key] : '—';
    $textRows[] = $label . ': ' . $value;
    $htmlRows  .= '<tr><td style="color:#666;vertical-align:top"><b>' . escape_html($label) . '</b></td>'
                . '<td style="white-space:pre-wrap">' . escape_html($value) . '</td></tr>';
}

$text = "Новый заказ с сайта «Отпечаток»\n\n" . implode("\n", $textRows)
      . ($pdfBinary !== '' ? "\n\nМакеты футболки — во вложении (PDF)." : '');

$html = '<h2>Новый заказ с сайта «Отпечаток»</h2>'
      . '<table cellpadding="6" style="border-collapse:collapse;font-family:Arial,sans-serif;font-size:14px">'
      . $htmlRows
      . '</table>'
      . ($pdfBinary !== '' ? '<p>Макеты футболки — во вложении (PDF).</p>' : '');

// ── Отправка через SMTP Haskimail (STARTTLS на порту 587) ────────────────
$mail = new PHPMailer(true); // true — ошибки выбрасываются как исключения

try {
    $mail->isSMTP();
    // Настройки для Mail.ru
    $mail->Host       = 'smtp.mail.ru';
    $mail->Port       = 465;
    $mail->SMTPSecure = PHPMailer::ENCRYPTION_SMTPS; // Для порта 465 используется SSL
    $mail->SMTPAuth   = true;

    // ТВОЙ ЛОГИН (полный адрес почты) и ПАРОЛЬ ПРИЛОЖЕНИЯ (не обычный пароль!)
    $mail->Username   = 'aidar.mukhitov@mail.ru';
    $mail->Password   = 'Qf38rtO2y8LW95N3rHuZ';

    $mail->Timeout    = 20;
    $mail->CharSet    = PHPMailer::CHARSET_UTF8;

    // Отправитель должен совпадать с тем, с чьего аккаунта отправляем
    $mail->setFrom('твоя_почта@mail.ru', 'Отпечаток');

    // Куда приходят заказы (можешь оставить свой Gmail или указать другой)
    $mail->addAddress('blacktea28497@gmail.com');

    // ... дальше остальной код (ReplyTo, Subject, Body и т.д.) ...

    // Если клиент указал e-mail, на письмо можно сразу ответить ему
    if (filter_var($order['email'], FILTER_VALIDATE_EMAIL)) {
        $mail->addReplyTo($order['email'], $order['name']);
    }

    $mail->Subject = 'Новый заказ: ' . $order['name'] . ', ' . $order['phone'];
    $mail->isHTML(true);
    $mail->Body    = $html;
    $mail->AltBody = $text;

    // PDF прикладываем из памяти — без сохранения на диск
    if ($pdfBinary !== '') {
        $mail->addStringAttachment($pdfBinary, 'order-' . date('Y-m-d') . '.pdf', PHPMailer::ENCODING_BASE64, 'application/pdf');
    }

    $mail->send();
} catch (Exception $e) {
    // Подробности пишем в лог ошибок хостинга, клиенту — короткое сообщение
    error_log('send-order.php: ошибка отправки письма: ' . $mail->ErrorInfo);
    json_response(502, ['ok' => false, 'error' => 'Не удалось отправить письмо']);
}

json_response(200, ['ok' => true]);
