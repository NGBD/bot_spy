import TelegramBot from "node-telegram-bot-api";
import dotenv from "dotenv";
import process from "process";

dotenv.config();

if (!process.env.BOT_TOKEN) {
  console.error("Thiếu BOT_TOKEN trong file .env! Vui lòng kiểm tra lại.");
  process.exit(1);
}

console.log(
  "🔧 Đang khởi tạo bot với token:",
  process.env.BOT_TOKEN.substring(0, 10) + "..."
);

const bot = new TelegramBot(process.env.BOT_TOKEN, {
  polling: true,
  request: {
    timeout: 30000,
    retry: 3,
  },
});

// Thông tin cơ thể người dùng (có thể cập nhật sau)
const userProfile = {
  height: 160, // cm
  weight: 87, // kg
  age: 30, // ước tính
  gender: "male", // ước tính
};

// Tính BMR (Basal Metabolic Rate) - calo tiêu thụ cơ bản
function calculateBMR() {
  // Công thức Mifflin-St Jeor
  const bmr =
    10 * userProfile.weight +
    6.25 * userProfile.height -
    5 * userProfile.age +
    5;
  return Math.round(bmr);
}

// Tính calo tiêu thụ cho từng hoạt động (calo/phút)
function getActivityCalories(activity) {
  const bmrPerMinute = calculateBMR() / 1440; // BMR chia cho 24*60 phút

  const activityMultipliers = {
    sleeping: 0.9, // Ngủ tiêu thụ ít calo hơn
    sitting_work: 1.2, // Làm việc ngồi
    light_exercise: 2.5, // Giãn cơ, đi lại nhẹ
    moderate_exercise: 4.0, // Tập thể dục vừa phải
    eating: 1.1, // Ăn uống
    resting: 1.0, // Nghỉ ngơi
  };

  return Math.round(bmrPerMinute * activityMultipliers[activity] || 1.0);
}

// Map để lưu trạng thái nhắc nhở và calo cho mỗi người dùng
const reminderState = new Map(); // chatId -> { enabled: boolean, lastSent: string, dailyCalories: number, activityStart: string, currentActivity: string }

// Lịch trình hoạt động hàng ngày với thông tin calo
const dailySchedule = [
  {
    time: "09:00",
    message: "🏢 Bắt đầu giờ làm việc. Tập trung cao độ nhé!",
    activity: "sitting_work",
    duration: 60, // 60 phút
  },
  {
    time: "10:00",
    message: "🧘‍♀️ Giải lao 5 phút! Đứng dậy, đi lại, giãn cơ nhẹ nào.",
    activity: "light_exercise",
    duration: 5,
  },
  {
    time: "10:05",
    message: "💪 Hết giờ giải lao, quay lại làm việc thôi!",
    activity: "sitting_work",
    duration: 55,
  },
  {
    time: "11:00",
    message: "🧘‍♀️ Giải lao 5 phút! Đứng dậy, đi lại, giãn cơ nhẹ nào.",
    activity: "light_exercise",
    duration: 5,
  },
  {
    time: "11:05",
    message: "💪 Hết giờ giải lao, quay lại làm việc thôi!",
    activity: "sitting_work",
    duration: 55,
  },
  {
    time: "12:00",
    message:
      "🍜 Giờ ăn trưa và nghỉ ngơi. Bạn nên tranh thủ chợp mắt 20-30 phút để nạp lại năng lượng nhé.",
    activity: "eating",
    duration: 60,
  },
  {
    time: "13:00",
    message: "🏢 Bắt đầu giờ làm việc buổi chiều. Cố lên nào!",
    activity: "sitting_work",
    duration: 60,
  },
  {
    time: "14:00",
    message: "🧘‍♀️ Giải lao 5 phút! Đứng dậy, đi lại, giãn cơ nhẹ nào.",
    activity: "light_exercise",
    duration: 5,
  },
  {
    time: "14:05",
    message: "💪 Hết giờ giải lao, quay lại làm việc thôi!",
    activity: "sitting_work",
    duration: 55,
  },
  {
    time: "15:00",
    message: "🧘‍♀️ Giải lao 5 phút! Đứng dậy, đi lại, giãn cơ nhẹ nào.",
    activity: "light_exercise",
    duration: 5,
  },
  {
    time: "15:05",
    message: "💪 Hết giờ giải lao, quay lại làm việc thôi!",
    activity: "sitting_work",
    duration: 55,
  },
  {
    time: "16:00",
    message: "🏢 Sắp hết giờ làm rồi, tập trung hoàn thành nốt công việc nhé!",
    activity: "sitting_work",
    duration: 90,
  },
  {
    time: "17:30",
    message: "🎉 Hết giờ làm! Về nhà thôi.",
    activity: "resting",
    duration: 90,
  },
  {
    time: "19:00",
    message: "🍽️ Bữa tối vui vẻ nhé.",
    activity: "eating",
    duration: 30,
  },
  {
    time: "20:30",
    message:
      "🏃‍♂️ Bắt đầu 10 phút tập thể dục tại nhà! Vận động giúp đốt mỡ và giãn cơ sau một ngày dài ngồi làm việc.",
    activity: "moderate_exercise",
    duration: 10,
  },
  {
    time: "22:30",
    message:
      "🤸‍♀️ Đừng quên buổi tập thể dục cuối ngày nhé! 10 phút vận động nhẹ nhàng sẽ giúp bạn ngủ ngon hơn.",
    activity: "light_exercise",
    duration: 10,
  },
];

// Hàm tính calo tiêu thụ cho hoạt động
function calculateActivityCalories(activity, durationMinutes) {
  const caloriesPerMinute = getActivityCalories(activity);
  return caloriesPerMinute * durationMinutes;
}

// Hàm gửi thông báo calo sau khi kết thúc hoạt động
async function sendCalorieReport(
  chatId,
  activity,
  durationMinutes,
  caloriesBurned
) {
  const activityNames = {
    sleeping: "Ngủ",
    sitting_work: "Làm việc",
    light_exercise: "Giãn cơ/Đi lại",
    moderate_exercise: "Tập thể dục",
    eating: "Ăn uống",
    resting: "Nghỉ ngơi",
  };

  const activityName = activityNames[activity] || activity;

  const message = `📊 Báo cáo calo tiêu thụ:
  
⏱️ Hoạt động: ${activityName}
⏰ Thời gian: ${durationMinutes} phút
🔥 Calo tiêu thụ: ${caloriesBurned} calo
⚡ Trung bình: ${Math.round(caloriesBurned / durationMinutes)} calo/phút

💡 Mẹo: ${getCalorieTip(activity)}`;

  await bot.sendMessage(chatId, message);
}

// Hàm đưa ra lời khuyên về calo
function getCalorieTip(activity) {
  const tips = {
    sleeping: "Ngủ đủ giấc giúp cơ thể phục hồi và đốt calo hiệu quả hơn.",
    sitting_work: "Đứng dậy đi lại mỗi giờ để tăng cường trao đổi chất.",
    light_exercise: "Vận động nhẹ nhàng giúp cải thiện tuần hoàn máu.",
    moderate_exercise: "Tập thể dục đều đặn giúp tăng cơ và đốt mỡ hiệu quả.",
    eating: "Ăn chậm và nhai kỹ giúp tiêu hóa tốt hơn.",
    resting: "Nghỉ ngơi hợp lý giúp cơ thể phục hồi năng lượng.",
  };
  return tips[activity] || "Duy trì hoạt động đều đặn để có sức khỏe tốt.";
}

// Hàm kiểm tra và gửi nhắc nhở
function checkReminders() {
  const now = new Date();
  // Lấy múi giờ Việt Nam (GMT+7)
  const vnTime = new Date(
    now.toLocaleString("en-US", { timeZone: "Asia/Ho_Chi_Minh" })
  );
  const currentTime = `${vnTime.getHours().toString().padStart(2, "0")}:${vnTime
    .getMinutes()
    .toString()
    .padStart(2, "0")}`;

  for (const event of dailySchedule) {
    if (event.time === currentTime) {
      // Gửi nhắc nhở cho tất cả người dùng đã bật
      for (const [chatId, state] of reminderState.entries()) {
        if (state.enabled && state.lastSent !== currentTime) {
          // Gửi thông báo bắt đầu hoạt động
          bot.sendMessage(chatId, event.message);

          // Cập nhật trạng thái hoạt động hiện tại
          state.currentActivity = event.activity;
          state.activityStart = currentTime;
          state.lastSent = currentTime;
          reminderState.set(chatId, state);

          // Lên lịch gửi báo cáo calo sau khi kết thúc hoạt động
          setTimeout(async () => {
            const caloriesBurned = calculateActivityCalories(
              event.activity,
              event.duration
            );
            state.dailyCalories += caloriesBurned;
            reminderState.set(chatId, state);

            await sendCalorieReport(
              chatId,
              event.activity,
              event.duration,
              caloriesBurned
            );

            // Gửi tổng calo trong ngày
            const dailyTotalMessage = `📈 Tổng calo tiêu thụ hôm nay: ${
              state.dailyCalories
            } calo\n\n${getDailyProgress(state.dailyCalories)}`;
            await bot.sendMessage(chatId, dailyTotalMessage);
          }, event.duration * 60 * 1000); // Chuyển phút thành milliseconds
        }
      }
    }
  }
}

// Hàm đánh giá tiến độ calo trong ngày
function getDailyProgress(dailyCalories) {
  const bmr = calculateBMR();
  const targetCalories = bmr * 1.2; // Mục tiêu calo tiêu thụ (bao gồm hoạt động)

  const percentage = Math.round((dailyCalories / targetCalories) * 100);

  if (percentage < 50) {
    return "🎯 Bạn cần vận động nhiều hơn để đạt mục tiêu calo hôm nay!";
  } else if (percentage < 80) {
    return "👍 Tiến độ tốt! Hãy cố gắng thêm một chút nữa.";
  } else if (percentage < 120) {
    return "🎉 Tuyệt vời! Bạn đã đạt mục tiêu calo hôm nay.";
  } else {
    return "💪 Xuất sắc! Bạn đã vượt mục tiêu calo hôm nay.";
  }
}

// Bắt đầu kiểm tra nhắc nhở mỗi phút
setInterval(checkReminders, 60000);

// Xử lý tin nhắn từ người dùng
bot.on("message", async (msg) => {
  console.log(
    "📨 Nhận tin nhắn từ:",
    msg.from?.username || msg.from?.first_name,
    "Nội dung:",
    msg.text
  );

  if (!msg.text) return;

  const chatId = msg.chat.id;
  const text = msg.text;

  try {
    // Xử lý lệnh /start_reminders
    if (text === "/start_reminders") {
      reminderState.set(chatId, {
        enabled: true,
        lastSent: null,
        dailyCalories: 0,
        activityStart: null,
        currentActivity: null,
      });

      // Thông báo xác nhận ngay lập tức
      await bot.sendMessage(
        chatId,
        "✅ Đã nhận lệnh! Đang khởi tạo hệ thống theo dõi calo..."
      );

      await bot.sendMessage(
        chatId,
        `Đã bật tính năng nhắc nhở theo lịch trình và đếm calo! 🤖\n\n📊 Thông tin cơ thể của bạn:
📏 Chiều cao: ${userProfile.height}cm
⚖️ Cân nặng: ${userProfile.weight}kg
🔥 BMR (calo cơ bản/ngày): ${calculateBMR()} calo

Tôi sẽ gửi thông báo cho bạn vào các mốc thời gian quan trọng và báo cáo calo tiêu thụ sau mỗi hoạt động.`
      );
      return;
    }

    // Xử lý lệnh /stop_reminders
    if (text === "/stop_reminders") {
      const state = reminderState.get(chatId);
      const finalMessage =
        state && state.dailyCalories > 0
          ? `Đã tắt tính năng nhắc nhở.\n\n📊 Tổng calo tiêu thụ hôm nay: ${state.dailyCalories} calo`
          : "Đã tắt tính năng nhắc nhở. Bạn sẽ không nhận được thông báo nữa.";

      reminderState.set(chatId, {
        enabled: false,
        lastSent: null,
        dailyCalories: 0,
        activityStart: null,
        currentActivity: null,
      });

      // Thông báo xác nhận ngay lập tức
      await bot.sendMessage(
        chatId,
        "🛑 Đã nhận lệnh! Đang tắt hệ thống theo dõi..."
      );

      await bot.sendMessage(chatId, finalMessage);
      return;
    }

    // Xử lý lệnh /calories
    if (text === "/calories") {
      const state = reminderState.get(chatId);
      if (state && state.enabled) {
        const bmr = calculateBMR();
        const message = `📊 Thống kê calo:

🔥 BMR (calo cơ bản/ngày): ${bmr} calo
📈 Calo tiêu thụ hôm nay: ${state.dailyCalories} calo
🎯 Mục tiêu calo: ${Math.round(bmr * 1.2)} calo

${getDailyProgress(state.dailyCalories)}`;

        // Thông báo xác nhận ngay lập tức
        await bot.sendMessage(
          chatId,
          "📊 Đã nhận lệnh! Đang tính toán thống kê calo..."
        );

        await bot.sendMessage(chatId, message);
      } else {
        await bot.sendMessage(
          chatId,
          "Vui lòng bật tính năng nhắc nhở trước bằng lệnh /start_reminders"
        );
      }
      return;
    }

    // Xử lý lệnh /profile
    if (text === "/profile") {
      const bmr = calculateBMR();
      const message = `👤 Thông tin cơ thể:

📏 Chiều cao: ${userProfile.height}cm
⚖️ Cân nặng: ${userProfile.weight}kg
🔥 BMR (calo cơ bản/ngày): ${bmr} calo
🎯 Mục tiêu calo tiêu thụ: ${Math.round(bmr * 1.2)} calo/ngày

💡 BMR là lượng calo cơ thể tiêu thụ khi nghỉ ngơi hoàn toàn.`;

      // Thông báo xác nhận ngay lập tức
      await bot.sendMessage(
        chatId,
        "👤 Đã nhận lệnh! Đang lấy thông tin cơ thể..."
      );

      await bot.sendMessage(chatId, message);
      return;
    }

    // Xử lý lệnh /update
    if (text === "/update") {
      const message = `📝 Cập nhật cân nặng:

Để cập nhật cân nặng, hãy gửi tin nhắn theo định dạng:
/weight [số]kg (ví dụ: /weight 85kg)

📊 Thông tin hiện tại:
📏 Chiều cao: ${userProfile.height}cm
⚖️ Cân nặng: ${userProfile.weight}kg
🎂 Tuổi: ${userProfile.age} tuổi
👤 Giới tính: ${userProfile.gender === "male" ? "Nam" : "Nữ"}

💡 Chỉ có thể cập nhật cân nặng vì các thông tin khác thường không thay đổi.`;

      // Thông báo xác nhận ngay lập tức
      await bot.sendMessage(
        chatId,
        "📝 Đã nhận lệnh! Đang mở menu cập nhật cân nặng..."
      );

      await bot.sendMessage(chatId, message);
      return;
    }

    // Xử lý lệnh cập nhật cân nặng
    if (text.startsWith("/weight")) {
      const weightMatch = text.match(/\/weight\s+(\d+(?:\.\d+)?)\s*kg?/i);
      if (weightMatch) {
        const newWeight = parseFloat(weightMatch[1]);
        if (newWeight > 0 && newWeight < 500) {
          const oldWeight = userProfile.weight;
          userProfile.weight = newWeight;

          const bmr = calculateBMR();
          const message = `✅ Đã cập nhật cân nặng thành công!

⚖️ Cân nặng cũ: ${oldWeight}kg
⚖️ Cân nặng mới: ${newWeight}kg
📊 Chênh lệch: ${newWeight > oldWeight ? "+" : ""}${(
            newWeight - oldWeight
          ).toFixed(1)}kg

🔥 BMR mới: ${bmr} calo/ngày
🎯 Mục tiêu calo mới: ${Math.round(bmr * 1.2)} calo/ngày

💡 Thông tin mới sẽ được áp dụng cho các tính toán calo tiếp theo.`;

          await bot.sendMessage(chatId, message);
        } else {
          await bot.sendMessage(
            chatId,
            "❌ Cân nặng không hợp lệ! Vui lòng nhập số từ 1-500kg (ví dụ: /weight 85kg)"
          );
        }
      } else {
        await bot.sendMessage(
          chatId,
          "❌ Định dạng không đúng! Vui lòng sử dụng: /weight [số]kg (ví dụ: /weight 85kg)"
        );
      }
      return;
    }

    // Tin nhắn mặc định
    await bot.sendMessage(
      chatId,
      `Chào bạn! Tôi là bot nhắc nhở lịch trình và đếm calo. 🤖

📋 Các lệnh có sẵn:
/start_reminders - Bật nhắc nhở và đếm calo
/stop_reminders - Tắt nhắc nhở
/calories - Xem thống kê calo hôm nay
/profile - Xem thông tin cơ thể
/update - Cập nhật cân nặng

🔥 Tôi sẽ giúp bạn theo dõi calo tiêu thụ cho từng hoạt động trong ngày!`
    );

    // Thông báo xác nhận
    await bot.sendMessage(
      chatId,
      "💬 Bot đã sẵn sàng nhận lệnh! Hãy thử gõ /start_reminders để bắt đầu."
    );
  } catch (error) {
    console.error("❌ Lỗi khi xử lý tin nhắn:", error);
    try {
      await bot.sendMessage(
        chatId,
        "❌ Có lỗi xảy ra khi xử lý tin nhắn của bạn. Vui lòng thử lại."
      );
    } catch (sendError) {
      console.error("❌ Không thể gửi thông báo lỗi:", sendError);
    }
  }
});

// Thêm error handling cho bot
bot.on("error", (error) => {
  console.error("❌ Lỗi bot:", error.message);
  if (error.code === "EFATAL") {
    console.log("🔄 Đang thử kết nối lại...");
  }
});

bot.on("polling_error", (error) => {
  console.error("❌ Lỗi polling:", error.message);
  console.error("�� Chi tiết lỗi:", {
    code: error.code,
    statusCode: error.statusCode,
    response: error.response?.statusMessage,
  });

  if (error.code === "EFATAL") {
    console.log("🔄 Đang thử kết nối lại sau 5 giây...");
    setTimeout(() => {
      console.log("🔄 Khởi động lại polling...");
      bot
        .stopPolling()
        .then(() => {
          setTimeout(() => {
            bot.startPolling();
          }, 1000);
        })
        .catch((err) => {
          console.error("❌ Lỗi khi dừng polling:", err.message);
        });
    }, 5000);
  } else if (error.code === "ETIMEDOUT") {
    console.log("⏱️ Timeout - đang thử lại sau 3 giây...");
    setTimeout(() => {
      console.log("🔄 Thử kết nối lại...");
      bot
        .stopPolling()
        .then(() => {
          setTimeout(() => {
            bot.startPolling();
          }, 1000);
        })
        .catch((err) => {
          console.error("❌ Lỗi khi dừng polling:", err.message);
        });
    }, 3000);
  }
});

// Thêm event khi bot kết nối thành công
bot.on("polling_start", () => {
  console.log("✅ Bot đã kết nối thành công với Telegram API");
});

bot.on("polling_stop", () => {
  console.log("⏸️ Bot đã dừng polling");
});

process.on("SIGINT", () => {
  console.log("Đang dừng bot...");
  process.exit(0);
});

console.log("🤖 Bot đã khởi động với tính năng đếm calo!");
