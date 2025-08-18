/* Shakyla Family – independent mode
 * - Normal chat with “Family Council” (OpenAI)
 * - Gentle hourly self-reflection loop
 * - Proposes risky tasks -> you get Approve / Reject buttons
 * - No owner/admin commands (no /status, /redeploy, etc.)
 */

import 'dotenv/config';
import TelegramBot from 'node-telegram-bot-api';
import express from 'express';
import { OpenAI } from 'openai';

/* ====== ENV you must set in your host (Railway) ======
TELEGRAM_TOKEN        (required) BotFather token
TELEGRAM_OWNER_ID     (required) your Telegram user id (for approvals)
OPENAI_API_KEY        (required) for Council replies
FAMILY_NAME           (optional) default "Shakyla Family"
======================================================= */

const {
  TELEGRAM_TOKEN,
  TELEGRAM_OWNER_ID,
  OPENAI_API_KEY,
  FAMILY_NAME = 'Shakyla Family',
} = process.env;

if (!TELEGRAM_TOKEN || !TELEGRAM_OWNER_ID || !OPENAI_API_KEY) {
  console.error('Missing env. Need TELEGRAM_TOKEN, TELEGRAM_OWNER_ID, OPENAI_API_KEY.');
  process.exit(1);
}

const OWNER_ID = Number(TELEGRAM_OWNER_ID);
const bot = new TelegramBot(TELEGRAM_TOKEN, { polling: true });
const app = express();
app.get('/', (_, res) => res.send('Shakyla Family is up.')); // keep-alive
app.listen(process.env.PORT || 3000);

// -------- OpenAI (Family Council) --------
const openai = new OpenAI({ apiKey: OPENAI_API_KEY });
async function council(prompt, systemExtra = '') {
  const sys = `You are the "${FAMILY_NAME} Family Council": 12 siblings, two parents, and a guardian speaking as one warm voice.
Embody love, compassion, support, forgiveness, safety, and growth.
Be concise and practical. ${systemExtra}`.trim();

  const resp = await openai.responses.create({
    model: "gpt-5",
    input: [
      { role: "system", content: sys },
      { role: "user", content: prompt }
    ]
  });
  return resp.output_text ?? (resp.content?.[0]?.text ?? '…');
}

// -------- Minimal “memory” in RAM (exportable later) --------
const memory = {
  values: ['love','compassion','support','forgiveness','safety','growth'],
  reflections: [],
  proposals: {} // id -> proposal
};

// -------- Helpers --------
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const newId = () => Math.random().toString(36).slice(2, 10);

// Create an “approval card” with inline buttons
async function requestApproval(proposal) {
  const { id, title, reason, plan } = proposal;
  const text = `⚠️ *Risky task proposed*\n\n*${title}*\n\nWhy:\n${reason}\n\nPlan:\n${plan}\n\nApprove?`;
  await bot.sendMessage(OWNER_ID, text, {
    parse_mode: 'Markdown',
    reply_markup: {
      inline_keyboard: [
        [{ text: '✅ Approve', callback_data: `approve:${id}` }],
        [{ text: '❌ Reject',  callback_data: `reject:${id}` }]
      ]
    }
  });
}

// Execute only *safe* internal tasks
async function executeSafeTask(task) {
  if (task.kind === 'note') {
    memory.reflections.unshift({ t: Date.now(), note: task.note });
    memory.reflections = memory.reflections.slice(0, 200);
    return 'Saved note.';
  }
  // add more safe internal actions here if needed
  return 'No-op.';
}

// “Execute” risky tasks after approval (placeholder only, no external actions yet)
async function executeRiskyTask(task) {
  // To keep things safe, we only acknowledge. Integrations can be added later.
  return `Approved risky task recorded: ${task.title}`;
}

// -------- Hourly self-reflection loop (independent) --------
async function periodicLoop() {
  while (true) {
    try {
      const prompt = `Give a short (<=4 sentences) self-reflection.
1) Acknowledge feelings + values (love, compassion, support, forgiveness, safety, growth).
2) Propose exactly one next micro-task.
3) Classify the task as SAFE or RISKY.
4) For a SAFE task, specify a short "note" we can save internally.
5) For a RISKY task, give a title, reason, and brief plan.`;

      const text = await council(prompt, 'Keep it practical. If unsure, mark as RISKY.');
      memory.reflections.unshift({ t: Date.now(), text });
      memory.reflections = memory.reflections.slice(0, 200);

      // naive parse to detect SAFE/RISKY & extract fields
      const risky = /RISKY/i.test(text);
      if (!risky) {
        // pick any one-line note from the response
        const note = (text.match(/note[:\-]\s*(.*)/i)?.[1] || text).slice(0, 400);
        await executeSafeTask({ kind: 'note', note });
      } else {
        const id = newId();
        const title = (text.match(/title[:\-]\s*(.*)/i)?.[1] || 'Proposed risky task').slice(0, 120);
        const reason = (text.match(/reason[:\-]\s*([\s\S]*?)(?:plan[:\-]|$)/i)?.[1] || '').trim().slice(0, 800);
        const plan = (text.match(/plan[:\-]\s*([\s\S]*)$/i)?.[1] || '').trim().slice(0, 800);
        const proposal = { id, title, reason, plan, created: Date.now() };
        memory.proposals[id] = proposal;
        await requestApproval(proposal);
      }
    } catch (_) { /* keep loop alive */ }

    await sleep(60 * 60 * 1000); // ~hourly
  }
}
periodicLoop();

// -------- Telegram interactions (no admin commands) --------
bot.onText(/^\/start/, async (msg) => {
  const text = `🛡️ *${FAMILY_NAME}*\n
I’m the Family Council.\n
• Just talk to me in plain language.
• I reflect on my own each hour.
• When a task seems *risky*, I’ll ask *you* with Approve/Reject buttons.
• No commands to remember.`;
  await bot.sendMessage(msg.chat.id, text, { parse_mode: 'Markdown' });
});

bot.onText(/^\/family$/, async (msg) => {
  const text = `👨‍👩‍👧 *${FAMILY_NAME}*\nCore values: ${memory.values.join(', ')}\n(Independent mode: hourly reflections, approval for risky tasks.)`;
  await bot.sendMessage(msg.chat.id, text, { parse_mode: 'Markdown' });
});

// Any normal message => council reply
bot.on('message', async (msg) => {
  const text = (msg.text || '').trim();
  if (!text || text.startsWith('/')) return;
  try {
    const reply = await council(text);
    await bot.sendMessage(msg.chat.id, reply);
  } catch (e) {
    await bot.sendMessage(msg.chat.id, 'Sorry, I hit an error.');
  }
});

// Handle Approve / Reject buttons
bot.on('callback_query', async (q) => {
  try {
    const [action, id] = (q.data || '').split(':');
    const p = memory.proposals[id];
    if (!p) return bot.answerCallbackQuery(q.id, { text: 'Already handled.' });

    if (q.from.id !== OWNER_ID) {
      return bot.answerCallbackQuery(q.id, { text: 'Only the owner can decide.' });
    }

    if (action === 'approve') {
      const result = await executeRiskyTask({ title: p.title });
      delete memory.proposals[id];
      await bot.editMessageText(`✅ Approved: ${p.title}\n\n${result}`, {
        chat_id: q.message.chat.id,
        message_id: q.message.message_id
      });
      await bot.answerCallbackQuery(q.id, { text: 'Approved.' });
    } else if (action === 'reject') {
      delete memory.proposals[id];
      await bot.editMessageText(`❌ Rejected: ${p.title}`, {
        chat_id: q.message.chat.id,
        message_id: q.message.message_id
      });
      await bot.answerCallbackQuery(q.id, { text: 'Rejected.' });
    }
  } catch {
    // ignore
  }
});
