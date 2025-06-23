import dotenv from "dotenv";
import fetch from "node-fetch";

dotenv.config();

async function testConnection() {
  const token = process.env.BOT_TOKEN;

  if (!token) {
    console.error("❌ Không tìm thấy BOT_TOKEN trong file .env");
    return;
  }

  console.log("🔧 Đang test kết nối đến Telegram API...");
  console.log("📝 Token:", token.substring(0, 10) + "...");

  try {
    // Test 1: Kiểm tra bot info
    console.log("\n📊 Test 1: Kiểm tra thông tin bot...");
    const botInfoResponse = await fetch(
      `https://api.telegram.org/bot${token}/getMe`,
      {
        timeout: 10000,
      }
    );

    if (botInfoResponse.ok) {
      const botInfo = await botInfoResponse.json();
      console.log("✅ Bot info:", botInfo);
    } else {
      console.error(
        "❌ Lỗi bot info:",
        botInfoResponse.status,
        botInfoResponse.statusText
      );
    }

    // Test 2: Kiểm tra webhook info
    console.log("\n📊 Test 2: Kiểm tra webhook...");
    const webhookResponse = await fetch(
      `https://api.telegram.org/bot${token}/getWebhookInfo`,
      {
        timeout: 10000,
      }
    );

    if (webhookResponse.ok) {
      const webhookInfo = await webhookResponse.json();
      console.log("✅ Webhook info:", webhookInfo);
    } else {
      console.error(
        "❌ Lỗi webhook:",
        webhookResponse.status,
        webhookResponse.statusText
      );
    }

    // Test 3: Kiểm tra updates
    console.log("\n📊 Test 3: Kiểm tra updates...");
    const updatesResponse = await fetch(
      `https://api.telegram.org/bot${token}/getUpdates`,
      {
        timeout: 10000,
      }
    );

    if (updatesResponse.ok) {
      const updates = await updatesResponse.json();
      console.log("✅ Updates:", updates);
    } else {
      console.error(
        "❌ Lỗi updates:",
        updatesResponse.status,
        updatesResponse.statusText
      );
    }
  } catch (error) {
    console.error("❌ Lỗi kết nối:", error.message);

    if (error.code === "ETIMEDOUT") {
      console.log("💡 Gợi ý: Kiểm tra kết nối mạng hoặc thử dùng VPN");
    } else if (error.code === "ENOTFOUND") {
      console.log("💡 Gợi ý: Kiểm tra DNS hoặc kết nối internet");
    }
  }
}

testConnection();
