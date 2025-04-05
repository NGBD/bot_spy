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
const model = genAI.getGenerativeModel({
  model: "gemini-2.0-flash",
  generationConfig: {
    temperature: 0.7,
    topK: 40,
    topP: 0.95,
    maxOutputTokens: 1024,
  },
});

// Lưu trữ thông tin người dùng
const userData = new Map();

// Lưu trữ trạng thái của người dùng
const userState = new Map();

const SYSTEM_PROMPT = `Bạn là một chuyên gia dinh dưỡng có nhiều năm kinh nghiệm. 
Hãy trả lời các câu hỏi về dinh dưỡng, sức khỏe và chế độ ăn uống một cách chuyên nghiệp và khoa học.
Luôn đưa ra lời khuyên dựa trên các nghiên cứu khoa học và hướng dẫn dinh dưỡng chính thống.
Nếu không chắc chắn về thông tin, hãy nói rõ điều đó và khuyến nghị người dùng tham khảo ý kiến chuyên gia y tế.
Hãy trả lời bằng tiếng Việt và sử dụng ngôn ngữ dễ hiểu, gần gũi.`;

async function collectUserInfo(chatId) {
  if (!userData.has(chatId)) {
    userData.set(chatId, {});
    userState.set(chatId, "waiting_for_age");
    await bot.sendMessage(
      chatId,
      "Xin chào! Để tôi có thể tư vấn dinh dưỡng tốt nhất cho bạn, tôi cần một số thông tin cơ bản.\n\nBạn bao nhiêu tuổi?"
    );
  }
}

async function handleUserInfo(chatId, text) {
  const state = userState.get(chatId);
  const data = userData.get(chatId);

  switch (state) {
    case "waiting_for_age":
      const age = parseInt(text);
      if (isNaN(age) || age <= 0 || age > 120) {
        await bot.sendMessage(chatId, "Vui lòng nhập tuổi hợp lệ (1-120)");
        return;
      }
      data.age = age;
      userState.set(chatId, "waiting_for_height");
      await bot.sendMessage(chatId, "Chiều cao của bạn là bao nhiêu cm?");
      break;

    case "waiting_for_height":
      const height = parseInt(text);
      if (isNaN(height) || height <= 0 || height > 250) {
        await bot.sendMessage(
          chatId,
          "Vui lòng nhập chiều cao hợp lệ (1-250 cm)"
        );
        return;
      }
      data.height = height;
      userState.set(chatId, "waiting_for_weight");
      await bot.sendMessage(chatId, "Cân nặng của bạn là bao nhiêu kg?");
      break;

    case "waiting_for_weight":
      const weight = parseFloat(text);
      if (isNaN(weight) || weight <= 0 || weight > 300) {
        await bot.sendMessage(
          chatId,
          "Vui lòng nhập cân nặng hợp lệ (1-300 kg)"
        );
        return;
      }
      data.weight = weight;
      userState.set(chatId, "ready");

      // Tính BMI
      const heightInMeters = data.height / 100;
      const bmi = data.weight / (heightInMeters * heightInMeters);
      data.bmi = bmi.toFixed(2);

      await bot.sendMessage(
        chatId,
        `Cảm ơn bạn đã cung cấp thông tin!\n\nThông tin của bạn:\n- Tuổi: ${data.age}\n- Chiều cao: ${data.height} cm\n- Cân nặng: ${data.weight} kg\n- BMI: ${data.bmi}\n\nBây giờ tôi có thể tư vấn dinh dưỡng phù hợp cho bạn. Bạn có câu hỏi gì không?`
      );
      break;
  }
}

async function handleUserQuestion(msg) {
  try {
    const chatId = msg.chat.id;

    // Kiểm tra nếu người dùng chưa cung cấp thông tin
    if (!userData.has(chatId) || userState.get(chatId) !== "ready") {
      await collectUserInfo(chatId);
      return;
    }

    const userInfo = userData.get(chatId);
    const question = msg.text;

    const context = `Thông tin người dùng:
- Tuổi: ${userInfo.age}
- Chiều cao: ${userInfo.height} cm
- Cân nặng: ${userInfo.weight} kg
- BMI: ${userInfo.bmi}

Câu hỏi: ${question}`;

    const result = await model.generateContent({
      contents: [
        {
          parts: [{ text: SYSTEM_PROMPT }, { text: context }],
        },
      ],
    });

    const response = await result.response;
    const answer = response.text();

    await bot.sendMessage(chatId, answer);
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
  if (!msg.text) return;

  const chatId = msg.chat.id;
  const state = userState.get(chatId);

  // Nếu đang trong quá trình thu thập thông tin
  if (state && state !== "ready") {
    await handleUserInfo(chatId, msg.text);
    return;
  }

  // Xử lý câu hỏi thông thường
  await handleUserQuestion(msg);
});

process.on("SIGINT", () => {
  console.log("Đang dừng bot...");
  process.exit(0);
});

console.log("🤖 Bot đã khởi động!");
