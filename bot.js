import TelegramBot from "node-telegram-bot-api";
import dotenv from "dotenv";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { GoogleSpreadsheet } from "google-spreadsheet";
import { JWT } from "google-auth-library";
import process from "process";

dotenv.config();

if (
  !process.env.BOT_TOKEN ||
  !process.env.GEMINI_API_KEY ||
  !process.env.GOOGLE_SHEETS_CREDENTIALS ||
  !process.env.GOOGLE_SHEET_ID
) {
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

// Khởi tạo Google Sheets
const credentials = JSON.parse(process.env.GOOGLE_SHEETS_CREDENTIALS);
const serviceAccountAuth = new JWT({
  email: credentials.client_email,
  key: credentials.private_key,
  scopes: ["https://www.googleapis.com/auth/spreadsheets"],
});

const doc = new GoogleSpreadsheet(
  process.env.GOOGLE_SHEET_ID,
  serviceAccountAuth
);

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

// Hằng số cho tính toán macro
const MACRO_RATIOS = {
  balanced: { protein: 0.3, carbs: 0.4, fat: 0.3 },
  highProtein: { protein: 0.4, carbs: 0.3, fat: 0.3 },
  lowCarb: { protein: 0.3, carbs: 0.2, fat: 0.5 },
};

// Calo trên gram cho mỗi macro
const CALORIES_PER_GRAM = {
  protein: 4,
  carbs: 4,
  fat: 9,
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

function calculateMacros(tdee, goal) {
  let ratio;
  switch (goal) {
    case "giảm cân":
      ratio = MACRO_RATIOS.highProtein;
      break;
    case "tăng cơ":
      ratio = MACRO_RATIOS.highProtein;
      break;
    default:
      ratio = MACRO_RATIOS.balanced;
  }

  const proteinCalories = tdee * ratio.protein;
  const carbsCalories = tdee * ratio.carbs;
  const fatCalories = tdee * ratio.fat;

  return {
    protein: (proteinCalories / CALORIES_PER_GRAM.protein).toFixed(1),
    carbs: (carbsCalories / CALORIES_PER_GRAM.carbs).toFixed(1),
    fat: (fatCalories / CALORIES_PER_GRAM.fat).toFixed(1),
  };
}

function getVietnameseFoodExamples(macros) {
  return {
    protein: [
      "Thịt heo nạc (100g): 20g protein",
      "Thịt gà (100g): 25g protein",
      "Cá (100g): 20g protein",
      "Đậu phụ (100g): 8g protein",
      "Trứng (1 quả): 6g protein",
    ],
    carbs: [
      "Cơm trắng (1 bát): 45g carbs",
      "Bánh mì (1 ổ): 30g carbs",
      "Phở (1 tô): 50g carbs",
      "Bún (1 tô): 40g carbs",
      "Khoai lang (100g): 20g carbs",
    ],
    fat: [
      "Dầu ăn (1 muỗng): 14g fat",
      "Lạc (30g): 14g fat",
      "Mè (1 muỗng): 4g fat",
      "Thịt mỡ (100g): 20g fat",
      "Sữa đặc (1 muỗng): 3g fat",
    ],
  };
}

// Hàm lưu thông tin người dùng vào Google Sheets
async function saveUserInfoToSheet(chatId, userInfo) {
  try {
    await doc.loadInfo();
    console.log("Đang tìm sheet User Info...");

    // Tìm sheet User Info
    let sheet = doc.sheetsByTitle["User Info"];
    if (!sheet) {
      console.log("Không tìm thấy sheet User Info, đang tạo mới...");
      sheet = await doc.addSheet({
        title: "User Info",
        headerValues: [
          "User ID",
          "Gender",
          "Age",
          "Height",
          "Weight",
          "Activity Level",
          "Goal",
          "BMI",
          "BMR",
          "TDEE",
          "Body Fat",
          "Ideal Weight",
          "Last Updated",
        ],
      });
    }

    console.log("Đang đọc dữ liệu từ sheet...");
    const rows = await sheet.getRows();
    console.log(`Tìm thấy ${rows.length} dòng trong sheet User Info`);

    const existingRow = rows.find((row) => {
      const rowUserId = row["User ID"]?.toString();
      const chatIdStr = chatId.toString();
      console.log(`So sánh User ID: ${rowUserId} với ${chatIdStr}`);
      return rowUserId === chatIdStr;
    });

    if (existingRow) {
      console.log("Đang cập nhật thông tin người dùng hiện có...");
      // Cập nhật thông tin người dùng hiện có
      existingRow["Gender"] = userInfo.gender;
      existingRow["Age"] = userInfo.age;
      existingRow["Height"] = userInfo.height;
      existingRow["Weight"] = userInfo.weight;
      existingRow["Activity Level"] = userInfo.activityLevel;
      existingRow["Goal"] = userInfo.goal;
      existingRow["BMI"] = userInfo.bmi;
      existingRow["BMR"] = userInfo.bmr;
      existingRow["TDEE"] = userInfo.tdee;
      existingRow["Body Fat"] = userInfo.bodyFat;
      existingRow["Ideal Weight"] = userInfo.idealWeight;
      existingRow["Last Updated"] = new Date().toISOString();
      await existingRow.save();
      console.log("Đã cập nhật thông tin người dùng");
    } else {
      console.log("Đang thêm thông tin người dùng mới...");
      // Thêm thông tin người dùng mới
      await sheet.addRow({
        "User ID": chatId,
        Gender: userInfo.gender,
        Age: userInfo.age,
        Height: userInfo.height,
        Weight: userInfo.weight,
        "Activity Level": userInfo.activityLevel,
        Goal: userInfo.goal,
        BMI: userInfo.bmi,
        BMR: userInfo.bmr,
        TDEE: userInfo.tdee,
        "Body Fat": userInfo.bodyFat,
        "Ideal Weight": userInfo.idealWeight,
        "Last Updated": new Date().toISOString(),
      });
      console.log("Đã thêm thông tin người dùng mới");
    }

    return true;
  } catch (error) {
    console.error("Lỗi khi lưu thông tin người dùng:", error);
    return false;
  }
}

// Hàm đọc thông tin người dùng từ Google Sheets
async function loadUserInfoFromSheet(chatId) {
  try {
    await doc.loadInfo();
    console.log("Đang tìm sheet User Info...");

    const sheet = doc.sheetsByTitle["User Info"];
    if (!sheet) {
      console.log("Không tìm thấy sheet User Info");
      return null;
    }

    console.log("Đang đọc dữ liệu từ sheet...");
    const rows = await sheet.getRows();
    console.log(`Tìm thấy ${rows.length} dòng trong sheet User Info`);

    const userRow = rows.find((row) => {
      const rowUserId = row["User ID"]?.toString();
      const chatIdStr = chatId.toString();
      console.log(`So sánh User ID: ${rowUserId} với ${chatIdStr}`);
      return rowUserId === chatIdStr;
    });

    if (!userRow) {
      console.log(`Không tìm thấy thông tin cho User ID: ${chatId}`);
      return null;
    }

    console.log("Tìm thấy thông tin người dùng:", userRow);

    // Đảm bảo chuyển đổi đúng kiểu dữ liệu
    const userInfo = {
      gender: userRow["Gender"]?.toString() || "",
      age: parseInt(userRow["Age"]) || 0,
      height: parseInt(userRow["Height"]) || 0,
      weight: parseFloat(userRow["Weight"]) || 0,
      activityLevel: userRow["Activity Level"]?.toString() || "",
      goal: userRow["Goal"]?.toString() || "",
      bmi: parseFloat(userRow["BMI"]) || 0,
      bmr: parseFloat(userRow["BMR"]) || 0,
      tdee: parseFloat(userRow["TDEE"]) || 0,
      bodyFat: parseFloat(userRow["Body Fat"]) || 0,
      idealWeight: parseFloat(userRow["Ideal Weight"]) || 0,
    };

    // Kiểm tra xem có đủ thông tin không
    if (
      !userInfo.gender ||
      !userInfo.age ||
      !userInfo.height ||
      !userInfo.weight
    ) {
      console.log("Thiếu thông tin cơ bản của người dùng");
      return null;
    }

    console.log("Thông tin người dùng đã được load:", userInfo);
    return userInfo;
  } catch (error) {
    console.error("Lỗi khi đọc thông tin người dùng:", error);
    return null;
  }
}

// Cập nhật hàm collectUserInfo
async function collectUserInfo(chatId) {
  try {
    console.log(`Bắt đầu thu thập thông tin cho User ID: ${chatId}`);

    // Luôn kiểm tra thông tin từ Google Sheets trước
    const savedUserInfo = await loadUserInfoFromSheet(chatId);
    if (savedUserInfo) {
      console.log("Đã tìm thấy thông tin trong Google Sheets");
      userData.set(chatId, savedUserInfo);
      userState.set(chatId, "ready");
      await bot.sendMessage(
        chatId,
        "Tôi đã tìm thấy thông tin của bạn trong hệ thống. Bạn có thể bắt đầu sử dụng các tính năng của bot."
      );
      return;
    }

    console.log(
      "Không tìm thấy thông tin trong Google Sheets, bắt đầu thu thập mới"
    );

    // Nếu không tìm thấy thông tin trong Google Sheets, mới bắt đầu thu thập
    if (!userData.has(chatId)) {
      userData.set(chatId, {});
      userState.set(chatId, "waiting_for_gender");
      await bot.sendMessage(
        chatId,
        "Xin chào! Để tôi có thể tính toán các chỉ số sức khỏe chính xác cho bạn, tôi cần một số thông tin cơ bản.\n\nBạn là nam hay nữ? (nam/nữ)"
      );
    }
  } catch (error) {
    console.error("Lỗi khi thu thập thông tin người dùng:", error);
    await bot.sendMessage(
      chatId,
      "Xin lỗi, có lỗi xảy ra khi kiểm tra thông tin của bạn. Vui lòng thử lại sau."
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
      userState.set(chatId, "waiting_for_goal");
      await bot.sendMessage(
        chatId,
        "Mục tiêu của bạn là gì?\n1. Giảm cân\n2. Tăng cơ\n3. Duy trì cân nặng\n\nVui lòng chọn số (1-3)"
      );
      break;

    case "waiting_for_goal":
      const goal = parseInt(text);
      if (isNaN(goal) || goal < 1 || goal > 3) {
        await bot.sendMessage(chatId, "Vui lòng chọn số từ 1 đến 3");
        return;
      }
      const goals = ["giảm cân", "tăng cơ", "duy trì cân nặng"];
      data.goal = goals[goal - 1];
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

      // Lưu thông tin người dùng vào Google Sheets
      await saveUserInfoToSheet(chatId, data);

      // Tính toán macro
      const macros = calculateMacros(data.tdee, data.goal);
      const foodExamples = getVietnameseFoodExamples(macros);

      const message =
        `Cảm ơn bạn đã cung cấp thông tin!\n\nCác chỉ số sức khỏe của bạn:\n\n` +
        `📊 Chỉ số cơ bản:\n` +
        `- Tuổi: ${data.age}\n` +
        `- Chiều cao: ${data.height} cm\n` +
        `- Cân nặng: ${data.weight} kg\n` +
        `- Cân nặng lý tưởng: ${data.idealWeight} kg\n` +
        `- Mục tiêu: ${data.goal}\n\n` +
        `📈 Chỉ số sức khỏe:\n` +
        `- BMI: ${data.bmi}\n` +
        `- Tỷ lệ mỡ cơ thể: ${data.bodyFat}%\n` +
        `- BMR (calo cơ bản): ${data.bmr} kcal/ngày\n` +
        `- TDEE (tổng năng lượng tiêu hao): ${data.tdee} kcal/ngày\n\n` +
        `🍽️ Chế độ dinh dưỡng:\n` +
        `- Protein: ${macros.protein}g/ngày\n` +
        `- Carb: ${macros.carbs}g/ngày\n` +
        `- Fat: ${macros.fat}g/ngày\n\n` +
        `🍜 Gợi ý thực phẩm Việt Nam:\n` +
        `Protein:\n${foodExamples.protein.join("\n")}\n\n` +
        `Carb:\n${foodExamples.carbs.join("\n")}\n\n` +
        `Fat:\n${foodExamples.fat.join("\n")}\n\n` +
        `💡 Lời khuyên:\n` +
        `- Để ${data.goal}: Ăn khoảng ${data.tdee} kcal/ngày\n` +
        `- Chia nhỏ bữa ăn thành 3-5 bữa/ngày\n` +
        `- Uống đủ nước (2-3 lít/ngày)\n` +
        `- Kết hợp tập luyện phù hợp\n\n` +
        `Bạn có câu hỏi gì về dinh dưỡng không?`;

      await bot.sendMessage(chatId, message);
      break;
  }
}

async function analyzeFoodWithAI(foodName, weight) {
  try {
    const prompt = `Hãy phân tích dinh dưỡng cho ${foodName} với khối lượng ${weight}g. 
    Trả lời theo định dạng JSON với các trường sau:
    {
      "calo": số calo,
      "protein": số gram protein,
      "fat": số gram fat,
      "carb": số gram carb
    }
    Chỉ trả về JSON, không có bất kỳ văn bản nào khác.`;

    const result = await model.generateContent({
      contents: [
        {
          parts: [{ text: prompt }],
        },
      ],
    });

    const response = await result.response;
    const text = response.text();

    // Cắt bỏ các ký tự không phải JSON nếu có
    const jsonStart = text.indexOf("{");
    const jsonEnd = text.lastIndexOf("}") + 1;
    const jsonStr = text.slice(jsonStart, jsonEnd);

    return JSON.parse(jsonStr);
  } catch (error) {
    console.error("Lỗi khi phân tích thực phẩm:", error);
    return null;
  }
}

async function logFoodToSheet(chatId, foodName, weight, analysis) {
  try {
    await doc.loadInfo();
    let sheet = doc.sheetsByTitle["Food Log"];

    if (!sheet) {
      sheet = await doc.addSheet({
        title: "Food Log",
        headerValues: [
          "Date",
          "User ID",
          "Food",
          "Weight",
          "Calories",
          "Protein",
          "Fat",
          "Carbs",
        ],
      });
    }

    const now = new Date();
    const dateStr = now.toISOString().split("T")[0];

    await sheet.addRow({
      Date: dateStr,
      "User ID": chatId,
      Food: foodName,
      Weight: weight,
      Calories: analysis.calo,
      Protein: analysis.protein,
      Fat: analysis.fat,
      Carbs: analysis.carb,
    });

    return true;
  } catch (error) {
    console.error("Lỗi khi ghi vào Google Sheets:", error);
    return false;
  }
}

async function getDailySummary(chatId) {
  try {
    await doc.loadInfo();
    console.log("Đang tìm sheet Food Log...");

    const sheet = doc.sheetsByTitle["Food Log"];
    if (!sheet) {
      console.log("Không tìm thấy sheet Food Log");
      return null;
    }

    console.log("Đang đọc dữ liệu từ sheet Food Log...");
    const rows = await sheet.getRows();
    console.log(`Tìm thấy ${rows.length} dòng trong sheet Food Log`);

    const now = new Date();
    const dateStr = now.toISOString().split("T")[0];

    const todayRows = rows.filter((row) => {
      const rowDate = row["Date"]?.toString();
      const rowUserId = row["User ID"]?.toString();
      const chatIdStr = chatId.toString();
      console.log(
        `So sánh: Date=${rowDate}, User ID=${rowUserId} với ${chatIdStr}`
      );
      return rowDate === dateStr && rowUserId === chatIdStr;
    });

    console.log(`Tìm thấy ${todayRows.length} bữa ăn hôm nay`);

    const summary = {
      totalCalories: 0,
      totalProtein: 0,
      totalFat: 0,
      totalCarbs: 0,
      foods: [],
    };

    todayRows.forEach((row) => {
      summary.totalCalories += parseFloat(row["Calories"]) || 0;
      summary.totalProtein += parseFloat(row["Protein"]) || 0;
      summary.totalFat += parseFloat(row["Fat"]) || 0;
      summary.totalCarbs += parseFloat(row["Carbs"]) || 0;
      summary.foods.push({
        name: row["Food"]?.toString() || "",
        weight: parseFloat(row["Weight"]) || 0,
        calories: parseFloat(row["Calories"]) || 0,
      });
    });

    console.log("Tổng kết bữa ăn hôm nay:", summary);
    return summary;
  } catch (error) {
    console.error("Lỗi khi đọc tổng kết bữa ăn:", error);
    return null;
  }
}

async function handleUserQuestion(msg) {
  try {
    const chatId = msg.chat.id;
    const question = msg.text;

    // Kiểm tra thông tin người dùng từ Google Sheets trước
    const savedUserInfo = await loadUserInfoFromSheet(chatId);
    if (savedUserInfo) {
      userData.set(chatId, savedUserInfo);
      userState.set(chatId, "ready");
    } else if (!userData.has(chatId) || userState.get(chatId) !== "ready") {
      await collectUserInfo(chatId);
      return;
    }

    // Kiểm tra nếu là lệnh LOG
    if (question.startsWith("LOG ")) {
      const foodMatch = question.substring(4).match(/(.+)\s+(\d+)g/);
      if (foodMatch) {
        const foodName = foodMatch[1].trim();
        const weight = parseInt(foodMatch[2]);

        await bot.sendMessage(chatId, "Đang phân tích và ghi log thực phẩm...");

        const analysis = await analyzeFoodWithAI(foodName, weight);
        if (analysis) {
          const logged = await logFoodToSheet(
            chatId,
            foodName,
            weight,
            analysis
          );
          if (logged) {
            const summary = await getDailySummary(chatId);
            if (summary) {
              const userInfo = userData.get(chatId);
              const remainingCalories = userInfo.tdee - summary.totalCalories;

              let message =
                `✅ Đã ghi log ${foodName} ${weight}g:\n\n` +
                `🔥 Calo: ${analysis.calo} kcal\n` +
                `🥩 Protein: ${analysis.protein}g\n` +
                `🥑 Fat: ${analysis.fat}g\n` +
                `🍚 Carb: ${analysis.carb}g\n\n` +
                `📊 Tổng kết hôm nay:\n` +
                `- Tổng calo: ${summary.totalCalories.toFixed(1)} kcal\n` +
                `- Còn lại: ${remainingCalories.toFixed(1)} kcal\n` +
                `- Tổng protein: ${summary.totalProtein.toFixed(1)}g\n` +
                `- Tổng fat: ${summary.totalFat.toFixed(1)}g\n` +
                `- Tổng carb: ${summary.totalCarbs.toFixed(1)}g\n\n` +
                `🍽️ Các món đã ăn:\n`;

              summary.foods.forEach((food) => {
                message += `- ${food.name} (${food.weight}g): ${food.calories} kcal\n`;
              });

              await bot.sendMessage(chatId, message);
            }
          } else {
            await bot.sendMessage(
              chatId,
              "Xin lỗi, không thể ghi log thực phẩm. Vui lòng thử lại sau."
            );
          }
          return;
        } else {
          await bot.sendMessage(
            chatId,
            "Xin lỗi, tôi không thể phân tích thực phẩm này. Bạn có thể thử lại hoặc hỏi thực phẩm khác."
          );
          return;
        }
      } else {
        await bot.sendMessage(
          chatId,
          "Vui lòng nhập đúng định dạng: LOG tên_thực_phẩm số_gram"
        );
        return;
      }
    }

    const userInfo = userData.get(chatId);
    const summary = await getDailySummary(chatId);

    // Xử lý các câu hỏi về dinh dưỡng hôm nay
    if (
      question.toLowerCase().includes("hôm nay") ||
      question.toLowerCase().includes("đã ăn") ||
      question.toLowerCase().includes("calo")
    ) {
      if (!summary) {
        await bot.sendMessage(
          chatId,
          "Hôm nay bạn chưa ghi log bất kỳ món ăn nào."
        );
        return;
      }

      const remainingCalories = userInfo.tdee - summary.totalCalories;
      const macros = calculateMacros(userInfo.tdee, userInfo.goal);
      const remainingMacros = {
        protein: macros.protein - summary.totalProtein,
        carbs: macros.carbs - summary.totalCarbs,
        fat: macros.fat - summary.totalFat,
      };

      let message =
        `📊 Tổng kết dinh dưỡng hôm nay:\n\n` +
        `🔥 Calo:\n` +
        `- Đã ăn: ${summary.totalCalories.toFixed(1)} kcal\n` +
        `- Còn lại: ${remainingCalories.toFixed(1)} kcal\n` +
        `- Mục tiêu: ${userInfo.tdee} kcal\n\n` +
        `🥩 Protein:\n` +
        `- Đã ăn: ${summary.totalProtein.toFixed(1)}g\n` +
        `- Còn lại: ${remainingMacros.protein.toFixed(1)}g\n` +
        `- Mục tiêu: ${macros.protein}g\n\n` +
        `🍚 Carb:\n` +
        `- Đã ăn: ${summary.totalCarbs.toFixed(1)}g\n` +
        `- Còn lại: ${remainingMacros.carbs.toFixed(1)}g\n` +
        `- Mục tiêu: ${macros.carbs}g\n\n` +
        `🥑 Fat:\n` +
        `- Đã ăn: ${summary.totalFat.toFixed(1)}g\n` +
        `- Còn lại: ${remainingMacros.fat.toFixed(1)}g\n` +
        `- Mục tiêu: ${macros.fat}g\n\n` +
        `🍽️ Các món đã ăn hôm nay:\n`;

      summary.foods.forEach((food) => {
        message += `- ${food.name} (${food.weight}g): ${food.calories} kcal\n`;
      });

      await bot.sendMessage(chatId, message);
      return;
    }

    // Kiểm tra nếu là câu hỏi về thực phẩm
    const foodMatch = question.match(/(.+)\s+(\d+)g/);
    if (foodMatch) {
      const foodName = foodMatch[1].trim();
      const weight = parseInt(foodMatch[2]);

      await bot.sendMessage(chatId, "Đang phân tích thực phẩm...");

      const analysis = await analyzeFoodWithAI(foodName, weight);
      if (analysis) {
        const message =
          `Thông tin dinh dưỡng cho ${foodName} ${weight}g:\n\n` +
          `🔥 Calo: ${analysis.calo} kcal\n` +
          `🥩 Protein: ${analysis.protein}g\n` +
          `🥑 Fat: ${analysis.fat}g\n` +
          `🍚 Carb: ${analysis.carb}g`;

        await bot.sendMessage(chatId, message);
        return;
      } else {
        await bot.sendMessage(
          chatId,
          "Xin lỗi, tôi không thể phân tích thực phẩm này. Bạn có thể thử lại hoặc hỏi thực phẩm khác."
        );
        return;
      }
    }

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
- Mục tiêu: ${userInfo.goal}

${
  summary
    ? `Dinh dưỡng hôm nay:
- Tổng calo: ${summary.totalCalories.toFixed(1)} kcal
- Tổng protein: ${summary.totalProtein.toFixed(1)}g
- Tổng carb: ${summary.totalCarbs.toFixed(1)}g
- Tổng fat: ${summary.totalFat.toFixed(1)}g`
    : "Chưa có dữ liệu về bữa ăn hôm nay"
}

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

async function handleCheckStatus(chatId) {
  try {
    // Kiểm tra nếu người dùng chưa cung cấp thông tin
    if (!userData.has(chatId) || userState.get(chatId) !== "ready") {
      await collectUserInfo(chatId);
      return;
    }

    const userInfo = userData.get(chatId);
    const summary = await getDailySummary(chatId);

    if (!summary) {
      await bot.sendMessage(chatId, "Chưa có dữ liệu về bữa ăn hôm nay.");
      return;
    }

    const remainingCalories = userInfo.tdee - summary.totalCalories;
    const macros = calculateMacros(userInfo.tdee, userInfo.goal);

    const remainingMacros = {
      protein: macros.protein - summary.totalProtein,
      carbs: macros.carbs - summary.totalCarbs,
      fat: macros.fat - summary.totalFat,
    };

    const message =
      `📊 Trạng thái dinh dưỡng hôm nay:\n\n` +
      `🔥 Calo:\n` +
      `- Đã ăn: ${summary.totalCalories.toFixed(1)} kcal\n` +
      `- Còn lại: ${remainingCalories.toFixed(1)} kcal\n` +
      `- Mục tiêu: ${userInfo.tdee} kcal\n\n` +
      `🥩 Protein:\n` +
      `- Đã ăn: ${summary.totalProtein.toFixed(1)}g\n` +
      `- Còn lại: ${remainingMacros.protein.toFixed(1)}g\n` +
      `- Mục tiêu: ${macros.protein}g\n\n` +
      `🍚 Carb:\n` +
      `- Đã ăn: ${summary.totalCarbs.toFixed(1)}g\n` +
      `- Còn lại: ${remainingMacros.carbs.toFixed(1)}g\n` +
      `- Mục tiêu: ${macros.carbs}g\n\n` +
      `🥑 Fat:\n` +
      `- Đã ăn: ${summary.totalFat.toFixed(1)}g\n` +
      `- Còn lại: ${remainingMacros.fat.toFixed(1)}g\n` +
      `- Mục tiêu: ${macros.fat}g\n\n` +
      `🍽️ Các món đã ăn hôm nay:\n`;

    summary.foods.forEach((food) => {
      message += `- ${food.name} (${food.weight}g): ${food.calories} kcal\n`;
    });

    await bot.sendMessage(chatId, message);
  } catch (error) {
    console.error("Lỗi khi kiểm tra trạng thái:", error);
    await bot.sendMessage(
      chatId,
      "Xin lỗi, không thể kiểm tra trạng thái ngay lúc này."
    );
  }
}

// Xử lý tin nhắn từ người dùng
bot.on("message", async (msg) => {
  if (!msg.text) return;

  const chatId = msg.chat.id;
  const text = msg.text;

  // Xử lý lệnh /checkstatus
  if (text === "/checkstatus") {
    await handleCheckStatus(chatId);
    return;
  }

  const state = userState.get(chatId);

  // Nếu đang trong quá trình thu thập thông tin
  if (state && state !== "ready") {
    await handleUserInfo(chatId, text);
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
