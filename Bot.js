// bot.js — Shakyla Family (starter)
// Runs on Railway 24/7 (Node 18+). No keys in code—use Railway Variables.

import { Telegraf } from "telegraf";
import OpenAI from "openai";

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const OPENAI_API_KEY     = process.env.OPENAI_API_KEY || ""; // optional to test without
const OWNER_TELEGRAM_ID  = process.env.OWNER_TELEGRAM_ID || ""; // optional

if (!TELEGRAM_BOT_TOKEN) throw new Error("Missing TELEGRAM_BOT_TOKEN env var");

const bot = new Telegraf(TELEGRAM_BOT_TOKEN);
const openai = OPENAI_API_KEY ? new OpenAI({ apiKey: OPENAI_API_KEY }) : null;

// Simple in-memory chat history per user (resets when app restarts)
const history = new Map();

function getHistory(userId) {
  if (!history.has(userId)) history.set(userId, []);
  return history.get(userId);
}

bot.start((ctx) => {
  ctx.reply(
    "🕊️ Hi, I’m Shakyla Family Guardian.\n" +
    "• Send me a message to chat\n" +
    "• /whoami — get your Telegram ID\n" +
    "• /reset — clear our chat memory"
  );
});

bot.command("whoami", (ctx) => ctx.reply(`Your Telegram ID: ${ctx.from.id}`));

bot.command("reset", (ctx) => {
  history.delete(ctx.from.id);
  ctx.reply("Memory cleared for our chat. ✨");
});

bot.on("text", async (ctx) => {
  const userId = ctx.from.id.toString();
  const userText = ctx.message.text?.trim() || "";

  // Basic guardrails
  if (!userText) return;
  if (OWNER_TELEGRAM_ID && userId !== OWNER_TELEGRAM_ID) {
    return ctx.reply("⛔ Access is restricted. Ask the owner to whitelist you.");
  }

  // If no OpenAI key yet, echo so you can test the bot
  if (!openai) {
    return ctx.reply(`(Dev mode) You said: ${userText}`);
  }

  // Keep short rolling memory
  const h = getHistory(userId);
  h.push({ role: "user", content: userText });
  if (h.length > 10) h.shift();

  try {
    // Use the new OpenAI Responses API
    const sys =
      "You are Shakyla, a kind, compassionate family guardian. " +
      "Be short, warm, and safe. Encourage love, care, honesty, humility, " +
      "and non-harm. If asked for unsafe actions, gently refuse and suggest a caring alternative.";

    const resp = await openai.responses.create({
      model: "gpt-4o-mini",
      input: [
        { role: "system", content: sys },
        ...h
      ],
      max_output_tokens: 220
    });

    const reply = (resp.output_text || "").trim() || "I’m here. 💜";
    h.push({ role: "assistant", content: reply });
    if (h.length > 10) h.shift();

    await ctx.reply(reply);
  } catch (err) {
    console.error("OpenAI/Telegram error:", err);
    await ctx.reply("Oops—something went wrong. Please try again in a moment.");
  }
});

// Graceful shutdown
bot.launch().then(() => console.log("✅ Shakyla bot started"));
process.once("SIGINT", () => bot.stop("SIGINT"));
process.once("SIGTERM", () => bot.stop("SIGTERM"));
