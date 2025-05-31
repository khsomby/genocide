const express = require("express");
const axios = require("axios");
const crypto = require("crypto");
const querystring = require('querystring');
const path = require('path');
const fs = require("fs-extra");
require('dotenv').config();

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));


const total = new Map();

app.get('/total', (req, res) => {
  const data = Array.from(total.values()).map((link, index) => ({
    session: index + 1,
    url: link.url,
    count: link.count,
    id: link.id,
    target: link.target,
    remaining: link.target - link.count,
    sessionActive: link.sessionActive,
  }));
  res.json(data);
});

app.post('/api/submit', async (req, res) => {
  const { cookie, url, amount, interval } = req.body;

  if (!cookie || !url || !amount || !interval) {
    return res.status(400).json({
      error: 'Missing state, url, amount, or interval',
    });
  }

  try {
    const cookies = await convertCookie(cookie);
    if (!cookies) {
      return res.status(400).json({
        status: 500,
        error: 'Invalid cookies',
      });
    }

    const sessionId = await startSession(cookies, url, amount, interval);
    res.status(200).json({
      status: 200,
      sessionId,
    });
  } catch (err) {
    return res.status(500).json({
      status: 500,
      error: err.message || err,
    });
  }
});

async function startSession(cookies, url, amount, interval) {
  const id = await getPostID(url);
  const accessToken = await getAccessToken(cookies);

  if (!id) {
    throw new Error("Unable to get link id: invalid URL, it's either a private post or visible to friends only");
  }

  const sessionKey = id + Math.random().toString(36).substr(2, 9);
  total.set(sessionKey, {
    url,
    id,
    count: 0,
    target: amount,
    interval,
    cookies,
    accessToken,
    sessionActive: true,
    lastUpdated: Date.now(),
  });

  runSession(sessionKey);
  monitorSession(sessionKey);

  return sessionKey;
}

async function runSession(sessionKey) {
  const session = total.get(sessionKey);

  if (!session || !session.sessionActive) return;

  const { id, target, interval, cookies, accessToken } = session;
  const headers = {
    accept: '*/*',
    'accept-encoding': 'gzip, deflate',
    connection: 'keep-alive',
    'content-length': '0',
    cookie: cookies,
    host: 'graph.facebook.com',
  };

  let sharedCount = session.count;

  async function sharePost() {
    try {
      const response = await axios.post(
        `https://graph.facebook.com/me/feed?link=https://m.facebook.com/${id}&published=0&access_token=${accessToken}`,
        {},
        { headers }
      );

      if (response.status === 200) {
        sharedCount++;
        total.set(sessionKey, { ...session, count: sharedCount, lastUpdated: Date.now() });

        if (sharedCount >= target) {
          total.delete(sessionKey);
          clearInterval(timer);
        }
      }
    } catch (error) {
      total.delete(sessionKey);
      clearInterval(timer);
    }
  }

  const timer = setInterval(sharePost, interval * 1000);

  setTimeout(() => {
    if (sharedCount >= target) {
      total.delete(sessionKey);
      clearInterval(timer);
    }
  }, target * interval * 1000);
}

function monitorSession(sessionKey) {
  const checkInterval = setInterval(() => {
    const session = total.get(sessionKey);
    if (session) {
      const currentTime = Date.now();
      if (currentTime - session.lastUpdated > 30000) {
        console.log(`Session ${sessionKey} has not been active for 30 seconds. Removing session.`);
        total.delete(sessionKey);
        clearInterval(checkInterval);
      }
    } else {
      clearInterval(checkInterval);
    }
  }, 30000);
}

async function getPostID(url) {
  try {
    const response = await axios.post('https://id.traodoisub.com/api.php', `link=${encodeURIComponent(url)}`, {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    });
    return response.data.id;
  } catch (error) {
    return null;
  }
}

async function getAccessToken(cookie) {
  try {
    const headers = {
      authority: 'business.facebook.com',
      accept:
        'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.9',
      'accept-language': 'vi-VN,vi;q=0.9,fr-FR;q=0.8,fr;q=0.7,en-US;q=0.6,en;q=0.5',
      cookie: cookie,
      referer: 'https://www.facebook.com/',
    };

    const response = await axios.get('https://business.facebook.com/content_management', { headers });
    const token = response.data.match(/"accessToken":\s*"([^"]+)"/);

    if (token && token[1]) {
      return token[1];
    }
  } catch (error) {
    return null;
  }
}

async function convertCookie(cookie) {
  try {
    const cookies = JSON.parse(cookie);
    const sbCookie = cookies.find((c) => c.key === 'sb');

    if (!sbCookie) {
      throw new Error('Invalid appstate');
    }

    const sbValue = sbCookie.value;
    return `sb=${sbValue}; ${cookies.slice(1).map((c) => `${c.key}=${c.value}`).join('; ')}`;
  } catch (error) {
    throw new Error('Error processing appstate');
  }
}

app.get('/access-token', async (req, res) => {
  const { username, password } = req.query;

  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password are required' });
  }

  const form = {
    adid: 'a1b2c8m4-e5f6-7890-g1h2-i3j4k5l6m7n8',
    email: username,
    password: password,
    format: 'json',
    device_id: 'z9y8n1w6-v5u4-t3s2-r1p0-q1o2n3m4l5k6',
    cpl: 'true',
    family_device_id: 'f1g7h3i4-j5k6-l7m8-n9o0-p1q2r3s4t5u6',
    locale: 'en_US',
    client_country_code: 'US',
    credentials_type: 'device_based_login_password',
    generate_session_cookies: '1',
    generate_analytics_claim: '1',
    generate_machine_id: '1',
    currently_logged_in_userid: '0',
    irisSeqID: 1,
    try_num: '1',
    enroll_misauth: 'false',
    meta_inf_fbmeta: 'NO_FILE',
    source: 'login',
    machine_id: 'KBz5fEj0GAvVAhtufg3nMDYG',
    fb_api_req_friendly_name: 'authenticate',
    fb_api_caller_class: 'com.facebook.account.login.protocol.Fb4aAuthHandler',
    access_token: '350685531728%7C62f8ce9f74b12f84c123cc23437a4a32'
  };

  const headers = {
    'Content-Type': 'application/x-www-form-urlencoded',
    'x-fb-friendly-name': form.fb_api_req_friendly_name,
    'x-fb-http-engine': 'Liger',
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/109.0.0.0 Safari/537.36',
  };

  const url = 'https://b-graph.facebook.com/auth/login';

  try {
    const response = await axios.post(url, querystring.stringify(form), { headers });
    const responseData = response.data;
    console.log('Response data:', responseData);

    if ('access_token' in responseData) {
      const accessToken = responseData.access_token;
      res.json({ accessToken });
    } else {
      res.status(400).json({ error: 'Access token not found in the response' });
    }
  } catch (error) {
    console.error('Error response data:', error.response ? error.response.data : error.message);
    res.status(500).json({ error: error.message, details: error.response ? error.response.data : null });
  }
});

app.get('/', (req, res) => {
  res.sendFile(__dirname + '/index.html');
});

const PORT = 2008;
app.listen(PORT, () => {
  console.log(`Service running`);
});