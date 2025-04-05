import TelegramBot from "node-telegram-bot-api";
import dotenv from "dotenv";
import { GoogleGenerativeAI } from "@google/generative-ai";
import process from "process";

dotenv.config();

if (!process.env.BOT_TOKEN || !process.env.GEMINI_API_KEY) {
  console.error("Thiếu thông tin trong file .env! Vui lòng kiểm tra lại.");
  process.exit(1);
}

const bot = new TelegramBot(process.env.BOT_TOKEN, {
  polling: true,
});

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: "gemini-pro" });

async function handleUserQuestion(msg) {
  try {
    const question = msg.text;
    const result = await model.generateContent(question);
    const response = await result.response;
    const answer = response.text();

    await bot.sendMessage(msg.chat.id, answer);
  } catch (error) {
    console.error("Lỗi khi xử lý câu hỏi:", error);
    await bot.sendMessage(
      msg.chat.id,
      "Xin lỗi, tôi không thể trả lời câu hỏi này ngay lúc này."
    );
  }
}

// Xử lý tin nhắn từ người dùng
bot.on("message", async (msg) => {
  if (msg.text) {
    await handleUserQuestion(msg);
  }
});

process.on("SIGINT", () => {
  console.log("Đang dừng bot...");
  process.exit(0);
});

console.log("🤖 Bot đã khởi động!");
