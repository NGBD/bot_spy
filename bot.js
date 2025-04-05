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

// Hằng số cho tính toán
const ACTIVITY_LEVELS = {
  sedentary: 1.2, // Ít vận động
  light: 1.375, // Vận động nhẹ
  moderate: 1.55, // Vận động vừa
  active: 1.725, // Vận động nhiều
  very_active: 1.9, // Vận động rất nhiều
};

function calculateBMR(weight, height, age, gender) {
  // Công thức Mifflin-St Jeor
  if (gender === "male") {
    return 10 * weight + 6.25 * height - 5 * age + 5;
  } else {
    return 10 * weight + 6.25 * height - 5 * age - 161;
  }
}

function calculateTDEE(bmr, activityLevel) {
  return bmr * activityLevel;
}

function calculateBodyFat(weight, height, age, gender, bmi) {
  // Công thức Deurenberg
  return 1.2 * bmi + 0.23 * age - 10.8 * (gender === "male" ? 1 : 0) - 5.4;
}

function calculateIdealWeight(height, gender) {
  // Công thức Hamwi
  if (gender === "male") {
    return 48 + 2.7 * ((height - 152.4) / 2.54);
  } else {
    return 45.5 + 2.2 * ((height - 152.4) / 2.54);
  }
}

async function collectUserInfo(chatId) {
  if (!userData.has(chatId)) {
    userData.set(chatId, {});
    userState.set(chatId, "waiting_for_gender");
    await bot.sendMessage(
      chatId,
      "Xin chào! Để tôi có thể tính toán các chỉ số sức khỏe chính xác cho bạn, tôi cần một số thông tin cơ bản.\n\nBạn là nam hay nữ? (nam/nữ)"
    );
  }
}

async function handleUserInfo(chatId, text) {
  const state = userState.get(chatId);
  const data = userData.get(chatId);

  switch (state) {
    case "waiting_for_gender":
      const gender = text.toLowerCase();
      if (gender !== "nam" && gender !== "nữ") {
        await bot.sendMessage(chatId, "Vui lòng nhập 'nam' hoặc 'nữ'");
        return;
      }
      data.gender = gender;
      userState.set(chatId, "waiting_for_age");
      await bot.sendMessage(chatId, "Bạn bao nhiêu tuổi?");
      break;

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
      userState.set(chatId, "waiting_for_activity");
      await bot.sendMessage(
        chatId,
        "Mức độ vận động của bạn:\n1. Ít vận động (ngồi nhiều)\n2. Vận động nhẹ (1-3 lần/tuần)\n3. Vận động vừa (3-5 lần/tuần)\n4. Vận động nhiều (6-7 lần/tuần)\n5. Vận động rất nhiều (2 lần/ngày)\n\nVui lòng chọn số (1-5)"
      );
      break;

    case "waiting_for_activity":
      const activity = parseInt(text);
      if (isNaN(activity) || activity < 1 || activity > 5) {
        await bot.sendMessage(chatId, "Vui lòng chọn số từ 1 đến 5");
        return;
      }
      const activityLevels = [
        "sedentary",
        "light",
        "moderate",
        "active",
        "very_active",
      ];
      data.activityLevel = activityLevels[activity - 1];
      userState.set(chatId, "ready");

      // Tính toán các chỉ số
      const heightInMeters = data.height / 100;
      data.bmi = (data.weight / (heightInMeters * heightInMeters)).toFixed(2);
      data.bmr = calculateBMR(
        data.weight,
        data.height,
        data.age,
        data.gender
      ).toFixed(2);
      data.tdee = calculateTDEE(
        data.bmr,
        ACTIVITY_LEVELS[data.activityLevel]
      ).toFixed(2);
      data.bodyFat = calculateBodyFat(
        data.weight,
        data.height,
        data.age,
        data.gender,
        data.bmi
      ).toFixed(2);
      data.idealWeight = calculateIdealWeight(data.height, data.gender).toFixed(
        2
      );

      const message =
        `Cảm ơn bạn đã cung cấp thông tin!\n\nCác chỉ số sức khỏe của bạn:\n\n` +
        `📊 Chỉ số cơ bản:\n` +
        `- Tuổi: ${data.age}\n` +
        `- Chiều cao: ${data.height} cm\n` +
        `- Cân nặng: ${data.weight} kg\n` +
        `- Cân nặng lý tưởng: ${data.idealWeight} kg\n\n` +
        `📈 Chỉ số sức khỏe:\n` +
        `- BMI: ${data.bmi}\n` +
        `- Tỷ lệ mỡ cơ thể: ${data.bodyFat}%\n` +
        `- BMR (calo cơ bản): ${data.bmr} kcal/ngày\n` +
        `- TDEE (tổng năng lượng tiêu hao): ${data.tdee} kcal/ngày\n\n` +
        `💡 Lời khuyên:\n` +
        `- Để giảm cân: Ăn ít hơn ${data.tdee} kcal/ngày\n` +
        `- Để tăng cân: Ăn nhiều hơn ${data.tdee} kcal/ngày\n` +
        `- Để duy trì cân nặng: Ăn khoảng ${data.tdee} kcal/ngày\n\n` +
        `Bạn có câu hỏi gì về dinh dưỡng không?`;

      await bot.sendMessage(chatId, message);
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
- Giới tính: ${userInfo.gender}
- Tuổi: ${userInfo.age}
- Chiều cao: ${userInfo.height} cm
- Cân nặng: ${userInfo.weight} kg
- BMI: ${userInfo.bmi}
- BMR: ${userInfo.bmr} kcal/ngày
- TDEE: ${userInfo.tdee} kcal/ngày
- Tỷ lệ mỡ cơ thể: ${userInfo.bodyFat}%
- Cân nặng lý tưởng: ${userInfo.idealWeight} kg
- Mức độ vận động: ${userInfo.activityLevel}

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
