const axios = require('axios');

const MOCEAN_API_TOKEN = process.env.MOCEAN_API_TOKEN;
const MOCEAN_BRAND = process.env.MOCEAN_BRAND || 'Billink';

function normalizeToPH63Format(inputNumber) {
  if (!inputNumber) return inputNumber;
  let digits = String(inputNumber).trim().replace(/[-\s]/g, '');
  if (digits.startsWith('+63')) return '63' + digits.slice(3);
  if (digits.startsWith('09')) return '63' + digits.slice(1);
  if (digits.startsWith('63')) return digits;
  if (digits.startsWith('9')) return '63' + digits;
  return digits;
}

function isValidPH63(d) {
  return /^63\d{10}$/.test(String(d));
}

async function sendSms({ to, text }) {
  if (!MOCEAN_API_TOKEN) {
    throw new Error('MOCEAN_API_TOKEN not configured');
  }
  const recipient = normalizeToPH63Format(to);
  if (!isValidPH63(recipient)) {
    throw new Error('Invalid phone format. Use 63XXXXXXXXXX');
  }
  const body = new URLSearchParams({
    'mocean-from': MOCEAN_BRAND,
    'mocean-to': recipient,
    'mocean-text': text.slice(0, 1000)
  });
  const res = await axios.post('https://rest.moceanapi.com/rest/2/sms', body, {
    headers: { Authorization: `Bearer ${MOCEAN_API_TOKEN}` }
  });
  return res.data;
}

module.exports = { sendSms, normalizeToPH63Format, isValidPH63 };



