const express = require('express');
const mqtt = require('mqtt');
const path = require('path');
const fs = require('fs'); 
const TelegramBot = require('node-telegram-bot-api');


const GAS_APP_URL = "https://script.google.com/macros/s/AKfycbz7FfMnGmtgBlBcAgFWGW4MEDSIs7i8iSCuzHCwI0_m7kDjYxw0xnT7US9e9HiT_3-X/exec";

const app = express();
const port = 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));


// ID CẤU HÌNH TELEGRAM

const TELEGRAM_TOKEN = '8289823033:AAGPNp_hzYeNZMcHQU3_o42uFiWMie4dRZI';
const MY_CHAT_IDS = ['8207059326', '-5174525031'];

const bot = new TelegramBot(TELEGRAM_TOKEN, { polling: true });

bot.on('polling_error', (err) => {
    console.error('error: [polling_error]', err);
    if (err && err.code === 'ETELEGRAM' && err.message && err.message.includes('409')) {
        console.warn('Telegram polling conflict detected (409). Stopping polling to avoid repeated errors.');
        try { 
            bot.stopPolling(); 
        } catch (e) { 
            /* ignore */ 
        }
        console.warn('Polling stopped.');
    }
});
// dạng mảng
let webChatNotifications = [];
// Biến chống Spam 
let lastAlerts = {}; 
const ALERT_COOLDOWN = 5 * 60 * 1000;



const OVERRIDE_DURATION = 30 * 60 * 1000; 
let manualStopTimestamp = 0; 

// Hàm gửi tin nhắn 
function sendTelegramMsg(message, isAlert = true, errorKey = null) {
    const now = Date.now();
    
    if (isAlert && errorKey) {
        if (lastAlerts[errorKey] && (now - lastAlerts[errorKey] < ALERT_COOLDOWN)) {
            return; 
        }
        lastAlerts[errorKey] = now;
    }
    
    const icon = isAlert ? "🚨 **THÔNG BÁO** 🚨" : "📊 BÁO CÁO ĐỊNH KỲ 📊";
    const time = new Date().toLocaleString('vi-VN');
    const content = `${icon}\n\n🕒 Thời gian: ${time}\n${message}`;

    // GỬI CHO TẤT CẢ ID TRONG DANH SÁCH
    MY_CHAT_IDS.forEach(chatId => {
        bot.sendMessage(chatId, content, { parse_mode: 'Markdown' })
           .catch((err) => console.error(`❌ Lỗi gửi Telegram tới ${chatId}:`, err.message));
    });

    // Đẩy vào danh sách cho Web
    let webMsg = content.replace(/\n/g, '<br>').replace(/\*\*/g, ''); 
    webChatNotifications.push(webMsg); 

    //  ĐỒNG BỘ CẢNH BÁO LÊN GOOGLE SHEET
    if (isAlert) {
        syncToGoogleSheet({
            type: "alarm_sync",
            alarm_type: errorKey || "SYSTEM_ALERT",
            message: message.replace(/\*\*/g, ''), 
            system_state: `Áp suất: ${currentSystemState.pressure}Bar, Tần số: ${currentSystemState.real_freq}Hz, Mode: ${currentSystemState.mode}`
        });
    }
}


//  QUẢN LÝ DỮ LIỆU TIÊU THỤ & BIỂU ĐỒ 
const USAGE_FILE = path.join(__dirname, 'daily_usage.json');
const CHART_FILE = path.join(__dirname, 'chart_history.json'); 
const REPORT_FILE = path.join(__dirname, 'report_yesterday.json');

function getVNDateString() {
    return new Date().toLocaleDateString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' });
}

let dailyStats = {
    date: getVNDateString(),
    totalM3: 0.0,
    hourly: new Array(24).fill(0.0)
};

let historyData = []; 
const MAX_HISTORY = 3000; 

// HÀM LƯU TẤT CẢ DỮ LIỆU XUỐNG Ổ CỨNG 
function saveAllDataToDisk() {
    try {
        // file tiêu thụ nước
        const usageDataToSave = {
            ...dailyStats,
            last_pressure: currentSystemState.pressure, 
            last_real_freq: currentSystemState.real_freq
        };
        fs.writeFileSync(USAGE_FILE, JSON.stringify(usageDataToSave, null, 2));

        // file biểu đồ
        const chartDataToSave = {
            date: dailyStats.date,
            data: historyData
        };
        fs.writeFileSync(CHART_FILE, JSON.stringify(chartDataToSave, null, 2));
    } catch (e) { 
        console.error("❌ Lỗi lưu file ổ cứng:", e); 
    }
}

// Hàm đọc dữ liệu khi khởi động
function loadAllDataFromDisk() {
    const today = getVNDateString();
    
    // --- LOAD DỮ LIỆU TIÊU THỤ ---
    try {
        if (fs.existsSync(USAGE_FILE)) {
            const data = JSON.parse(fs.readFileSync(USAGE_FILE, 'utf8'));
            // Nếu qua ngày mới thì reset về 0
            if (data.date !== today) {
                dailyStats = {
                    date: today,
                    totalM3: 0.0,
                    hourly: new Array(24).fill(0.0)
                };
                saveAllDataToDisk(); // Lưu ngay trạng thái mới
            } else {
                dailyStats = data;
                if (!dailyStats.hourly || dailyStats.hourly.length !== 24) {
                    dailyStats.hourly = new Array(24).fill(0.0);
                }
            }
        }
    } catch (e) { 
        console.error("Lỗi đọc file usage:", e); 
    }

    // TẢI DỮ LIỆU BIỂU ĐỒ 
    try {
        if (fs.existsSync(CHART_FILE)) {
            const chartFileContent = JSON.parse(fs.readFileSync(CHART_FILE, 'utf8'));
            
            // Kiểm tra xem dữ liệu trong file có phải của ngày hôm nay không
            if (chartFileContent.date === today) {
                historyData = chartFileContent.data || [];
            } else {
                // Nếu là dữ liệu ngày cũ thì reset biểu đồ
                console.log("Phát hiện dữ liệu biểu đồ ngày cũ. Đã Reset.");
                historyData = [];
            }
        }
    } catch (e) {
        console.error("Lỗi đọc file chart:", e);
    }
}

loadAllDataFromDisk(); 


// HÀM XỬ LÝ LOGIC CHAT DÙNG CHUNG CHO CẢ WEB & TELEGRAM
function processSystemQuery(text) {
    const s = currentSystemState; 
    text = text.toLowerCase();
    
    // Lấy thời gian thực hiện tại 
    const now = new Date().toLocaleString('vi-VN', { 
        timeZone: 'Asia/Ho_Chi_Minh',
        hour: '2-digit', 
        minute: '2-digit', 
        second: '2-digit', 
        day: '2-digit', 
        month: '2-digit',
        year:  '2-digit'
    });

    // 1. Kiểm tra thông số tổng quát
if (['status', 'trạng thái', 'kiểm tra', 'thông sô', 'check', 'trạm','thông số'].some(word => text.includes(word))) {
    const statusIcon = s.system_status === "ON" ? "✅ TRỰC TUYẾN" : "❌ NGOẠI TUYẾN";
    const pumpIcon = s.status === "ON" ? "🟢 ĐANG CHẠY" : "🔴 ĐANG DỪNG";
    return `
📊 **THÔNG SỐ HỆ THỐNG**
-------------------------------
🕒 *Thời gian cập nhật: ${now}*
-------------------------------
${statusIcon} **Kết nối:** ${s.system_status} 
🔴 **Trạng thái bơm:** ${s.status} 
🌊 **Áp suất:** ${s.pressure} Bar 
💧 **Lưu lượng:** ${s.flow} m³/h
📈 **Tổng hôm nay:** ${s.total_m3} m³
⚡ **Tần số thực:** ${s.real_freq} Hz
🎯 **Tần số đặt:** ${s.set_freq} Hz 
🔋 **Điện áp:** ${s.voltage} V
🛠️ **Chế độ:** ${s.mode}
--------------------------------
_Dữ liệu đầy đủ luôn nha sếp 😎_`;
    } 
    
    // 2. Kiểm tra Lịch trình
  
    else if (['lịch trình', 'lich trinh', 'lịch hẹn', 'lich hen', 'giờ chạy', 'gio chay', 'schedule', '/schedule', 'hẹn giờ'].some(word => text.includes(word))) {
        
        if (schedules.length === 0) {
            return `📅 **LỊCH TRÌNH:** Hiện tại chưa có lịch hẹn nào.\n_(Kiểm tra lúc: ${now})_`;
        }
        
        let schedMsg = `📅 **DANH SÁCH LỊCH HẸN (${now})**\n-------------------------------\n`;
        schedules.forEach((item, index) => {
            const start = new Date(item.startTime).toLocaleString('vi-VN', { hour: '2-digit', minute:'2-digit', day:'2-digit', month:'2-digit' });
            const end = new Date(item.endTime).toLocaleString('vi-VN', { hour: '2-digit', minute:'2-digit' });
            const mode = item.finalMode === 'MODE_AUTO' ? "Tự động" : "Dừng hẳn";
            const repeatText = item.repeat === 1 ? "(Lặp hàng ngày)" : "";
            const limitText = item.limitM3 > 0 ? `💧 Mục tiêu: ${item.limitM3} m³` : "";
            
         
            const lockStatus = (item.isLocked || isAllSchedulesLocked) ? "🔒 [TẠM KHÓA]" : "";

            schedMsg += `${index + 1}. ⏰ **${start} - ${end}** ${repeatText} ${lockStatus}\n`;
            schedMsg += `   ⚡ Tần số: ${item.freq} Hz \n ${limitText}\n`;
            schedMsg += `   🔄 Sau kết thúc: ${mode}\n\n`;
        });
        return schedMsg;
    }
    
    // 3. Các lệnh  khác
  // 1. Kiểm tra Thời gian 
    else if (['giờ', 'ngày', 'năm', 'thời gian', 'thứ mấy'].some(word => text.includes(word))) {
        return `📅 **Thời gian hiện tại:** ${now} \nChúc sếp một ngày làm việc hiệu quả và tràn đầy năng lượng! 😊`;
    }

    // 2. Kiểm tra Áp suất
    else if (['áp suất', 'pressure', 'pre', 'bar', 'nặng'].some(word => text.includes(word))) {
        return `🌊 **Áp suất hệ thống (${now}):** ${s.pressure} Bar\n_Trạng thái: ${s.pressure > 0 ? 'Đang có áp' : 'Không có áp'}_`;
    } 

    // 3. Kiểm tra Lưu lượng
    else if (['lưu lượng', 'flow', 'khối', 'm3', 'nước'].some(word => text.includes(word))) {
        return `💧 **Lưu lượng hiện tại:** ${s.flow} m³/h\n📈 **Tổng nước đã dùng hôm nay:** ${s.total_m3} m³\n🕒 _Lúc: ${now}_`;
    }

    // 4. Kiểm tra Tần số
    else if (['tần số', 'freq', 'hz', 'tốc độ', 'nhanh', 'chậm'].some(word => text.includes(word))) {
        return `⚡ **Thông số tần số:**\n- Thực tế: ${s.real_freq} Hz\n- Cài đặt: ${s.set_freq} Hz\n🚀 _Tốc độ đang được kiểm soát ổn định._`; 
    } 

    // 5. Kiểm tra Điện áp
    else if (['điện áp', 'volt', 'vôn', 'điện có khỏe không', 'nguồn'].some(word => text.includes(word))) {
        return `🔋 **Thông số điện áp:** ${s.voltage} Volt\n_Đảm bảo an toàn cho thiết bị._`; 
    }

    // 6. Kiểm tra Trạng thái bơm (Quan trọng nhất)
    else if (['trạng thái', 'status', 'bơm sao rồi', 'đang chạy hay dừng', 'bơm'].some(word => text.includes(word))) {
        const runIcon = s.status === "ON" ? "🟢 ĐANG CHẠY" : "🔴 ĐANG DỪNG";
        const modeText = (s.mode === 'MODE_AUTO' || s.mode === 'AUTO') ? "Tự động (Schedule)" : "Thủ công (Manual)";
        return `${runIcon}\n🛠️ **Chế độ:** ${modeText}\n🕒 **Cập nhật lúc:** ${now}`;
    }
       // Xử lý các câu hỏi tình cảm/thả thính
    else if (
        ['yêu', 'iu', 'thương', 'love', 'thich', 'thích'].some(word => text.includes(word)) && 
        ['anh', 'không', 'khong', 'khom', 'hong', 'hông', 'a '].some(word => text.includes(word))
    ) {
        return `🤖 Iu em Pía Khánh Giang nhìu lémmm. 😊💙`;
    }


 
    // LOGIC DỮ LIỆU BÁO CÁO
    const reportKeywords = [
        'dữ liệu', 'bao cao', 'báo cáo', 'hôm qua', 'hom qua', 
        'gần nhất', 'gan nhat', 'cuối ngày', 'cuoi ngay', 'tổng lượng'
    ];


    if (reportKeywords.some(word => text.includes(word))) {
        let oldReport;
        try {
          
            if (fs.existsSync(REPORT_FILE)) {
                oldReport = JSON.parse(fs.readFileSync(REPORT_FILE, 'utf8'));
            }
        } catch (e) { 
            console.error("Lỗi đọc file báo cáo cũ:", e); 
        }

        if (oldReport) {
            const pLast = oldReport.last_pressure !== undefined ? oldReport.last_pressure : 0.0;
            const fLast = oldReport.last_real_freq !== undefined ? oldReport.last_real_freq : 0.0;
            const totalLast = parseFloat(oldReport.totalM3 || 0).toFixed(3);

            return `
📊 **BÁO CÁO DỮ LIỆU HÔM QUA**
-------------------------------
📅 **Ngày ghi nhận:** ${oldReport.date}
💧 **Tổng lưu lượng:** ${totalLast} m³
🌊 **Áp suất cuối:** ${pLast} Bar
⚡ **Tần số cuối:** ${fLast} Hz
-------------------------------
_Dữ liệu này là tổng kết của ngày hôm qua (${oldReport.date})._`;
        } else {
            
            return `Thưa sếp, hệ thống chưa có dữ liệu hôm qua vui lòng thử khởi động lại. Sếp xem tạm dữ liệu hôm nay bằng lệnh **'kiểm tra'** nhé!`;
        }
    }
    // ...
    // Kiểm tra thông tin sinh viên 
    else if (text.includes('sinh viên') || text.includes('thông tin sinh viên') || text.includes('người tạo')|| text.includes('người thực hiện')|| text.includes('sinh viên thực hiện')) {
        return `
🎓 **THÔNG TIN SINH VIÊN**
-------------------------------
👤 **Họ và tên:** Cao Thanh Hiệp
🆔 **MSSV:** 42101388
🏫 **Lớp:** 21040302
📚 **Đề tài:** Triển khai số hóa trạm bơm nước sinh hoạt và điều khiển tự động
{IMAGE:/hiep-profile.jpg}
-------------------------------
_Rất vui được hỗ trợ sếp!_ 😊`;
    }
    return null; 
}


//  TELEGRAM BOT LOGIC

bot.on('message', (msg) => {
    if (!msg.text) return;
    
    const chatId = msg.chat.id;
    const text = msg.text.toLowerCase();

    // -LẤY THÔNG TIN NGƯỜI GỬI 
    const firstName = msg.from.first_name || ""; 
    const lastName = msg.from.last_name || "";
    const username = msg.from.username ? `@${msg.from.username}` : "Không có";
    const fullName = `${firstName} ${lastName}`.trim() || "Người dùng ẩn danh";

    // HIỂN THỊ RA CMD 
    console.log(`------------------------------------------`);
    console.log(`📩 TIN NHẮN MỚI TỪ TELEGRAM`);
    console.log(`👤 Người gửi: ${fullName}`);
    console.log(`🆔 Username: ${username}`);
    console.log(`🔑 Chat ID: ${chatId}`);
    console.log(`💬 Nội dung: "${text}"`);
    console.log(`------------------------------------------`);

    // Bước 1: Gọi hàm xử lý chung 
    const systemReply = processSystemQuery(text);

    if (systemReply) {
        bot.sendMessage(chatId, systemReply, { parse_mode: 'Markdown' });
    } 
    else if (text === '/id') {
        bot.sendMessage(chatId, `🆔 Chat ID của bạn là: \`${chatId}\``, { parse_mode: 'Markdown' });
    }
    else if (text === '/ping') {
        bot.sendMessage(chatId, "🤖 Server Node.js vẫn đang hoạt động!");
    }
    else {
        bot.sendMessage(chatId, "Chào sếp! Sếp muốn kiểm tra thông tin nào:😁\n- **'Thông tin sinh viên'** \n- **'kiểm tra'**: Xem tất cả thông số\n- **'áp suất'**: Xem áp suất riêng\n- **'lưu lượng'**: Xem lưu lượng riêng\n- **'tần số'**: Xem tần số riêng\n- **'điện áp'**: Xem điện áp riêng\n- **'lịch trình'**: xem lịch đã được đặt\n- **'ngày tháng năm'**: xem ngày tháng năm hôm nay\n- **'Dữ liệu cuối'**: xem dữ liệu ngày hôm qua", { parse_mode: 'Markdown' });
    }
});



// 2. CẤU HÌNH MQTT & BIẾN HỆ THỐNG

const mqttHost = 'mqtt://phuongnamdts.com'; 
const mqttOptions = {
    port: 4783,
    username: 'baonammqtt',
    password: 'mqtt@d1git',
};

const TOPIC_DATA = 'esp32/pump/data';       
const TOPIC_CONTROL = 'esp32/pump/control'; 

// Biến theo dõi trạng thái
let lastMqttMessageTime = Date.now();
const MAX_SILENCE_MS = 30000; 
let isOfflineNotified = false; 
let previousStatus = "OFF";    

// Biến hỗ trợ lưu trữ tối ưu
let lastSavedFreq = -1;
let lastSavedPressure = -1;
let lastSavedTime = 0;
const TIME_HEARTBEAT = 60000; 

// BIẾN TOÀN CỤC CHO PHIÊN CHẠY MỤC TIÊU LƯU LƯỢNG
let activeSessionLimit = 0;   
let startSessionTotalM3 = 0;  

// Trạng thái hệ thống hiện tại
let currentSystemState = {
    pressure: 0.0,
    voltage: 0.0,
    flow: 0.0,
    total_m3: 0.0, 
    set_freq: 0.0,
    real_freq: 0.0,
    status: "OFF",
    mode: "MANUAL",
    system_status: "OFFLINE"
};

let schedules = []; 
let isAllSchedulesLocked = false; 
const DATA_FILE = path.join(__dirname, 'schedules.json'); 

// Hàm lưu/đọc file schedules
function saveToDisk() {
    try { 
        fs.writeFileSync(DATA_FILE, JSON.stringify(schedules, null, 2)); 
    } catch (err) { 
        console.error("❌ Lỗi lưu file:", err); 
    }
}

function loadFromDisk() {
    try {
        if (fs.existsSync(DATA_FILE)) {
            schedules = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
        }
    } catch (err) { 
        schedules = []; 
    }
}

// 3. KHỞI TẠO SERVER & MQTT
loadFromDisk(); 

const client = mqtt.connect(mqttHost, mqttOptions);

client.on('connect', () => {
    console.log(`
    *****************************************
    * SERVER TRẠM BƠM ĐANG CHẠY...        *
    * Cổng: ${port}                          *
    * Telegram Bot: Đã khởi động          *
    *****************************************
    `);
    client.subscribe(TOPIC_DATA);
});

client.on('message', (topic, message) => {
    if (topic === TOPIC_DATA) {
        try {
            const now = Date.now();
            const timeDiffSeconds = (now - lastMqttMessageTime) / 1000; 
            lastMqttMessageTime = now; 
            
            const data = JSON.parse(message.toString());

            const today = getVNDateString();
            if (dailyStats.date !== today) {
                try {
                    const finalReportData = {
                        date: dailyStats.date,           
                        totalM3: dailyStats.totalM3,     
                        last_pressure: currentSystemState.pressure, 
                        last_real_freq: currentSystemState.real_freq
                    };
                    // Ghi xuống file report_yesterday.json
                    fs.writeFileSync(REPORT_FILE, JSON.stringify(finalReportData, null, 2));
                    console.log(`💾 Đã lưu báo cáo ngày ${dailyStats.date} vào file report_yesterday.json`);
                } catch (err) {
                    console.error("❌ Lỗi lưu báo cáo ngày cũ:", err);
                }

               
                const yesterdayDate = dailyStats.date;
                const yesterdayTotal = dailyStats.totalM3.toFixed(3);
                
                const summaryMsg = `
🌟 **CẬP NHẬT NGÀY MỚI** 🌟
-------------------------------
Đã qua ngày **${today}**. 
Chúc sếp một ngày làm việc vui vẻ! 😊

📊 **TỔNG KẾT HÔM QUA (${yesterdayDate})**
-------------------------------
💧 Tổng lưu lượng sử dụng là: **${yesterdayTotal} m³**
-------------------------------
_Hệ thống đã reset dữ liệu cho ngày mới._`;

                sendTelegramMsg(summaryMsg, false);
                
                // 3. Reset dữ liệu cho ngày mới
                dailyStats = {
                    date: today,
                    totalM3: 0.0,
                    hourly: new Array(24).fill(0.0)
                };
                
                historyData = [];
                lastSavedFreq = -1;
                lastSavedPressure = -1;
                
                // 4. Lưu trạng thái mới xuống ổ cứng
                saveAllDataToDisk();
            }
           

            // Tính toán lưu lượng cộng dồn
            if (timeDiffSeconds > 0 && timeDiffSeconds < 10) {
                const currentFlow = parseFloat(data.flow || 0); // m3/h
                // Công thức: m3 = (m3/h) * (giây / 3600)
                const addedVolume = currentFlow * (timeDiffSeconds / 3600);
                
                dailyStats.totalM3 += addedVolume;
                
          
                const vnTimeStr = new Date().toLocaleString("en-US", {timeZone: "Asia/Ho_Chi_Minh"});
                const currentHourVN = new Date(vnTimeStr).getHours();
                
                if (dailyStats.hourly[currentHourVN] !== undefined) {
                    dailyStats.hourly[currentHourVN] += addedVolume;
                }
            }

            // Cập nhật dữ liệu 
            currentSystemState.pressure = parseFloat(data.pressure || 0);
            currentSystemState.real_freq = parseFloat(data.actual_freq || 0);
            currentSystemState.set_freq = parseFloat(data.set_freq || 0);
            currentSystemState.voltage = parseFloat(data.voltage || 0);
            currentSystemState.flow = parseFloat(data.flow || 0);
            currentSystemState.total_m3 = dailyStats.totalM3.toFixed(3); 
            
            if (data.running_status !== undefined) currentSystemState.status = data.running_status ? "ON" : "OFF";
            if (data.control_mode) currentSystemState.mode = data.control_mode;

            currentSystemState.system_status = "ON";

            if (isOfflineNotified) {
                sendTelegramMsg("✅ **ĐÃ CÓ TÍN HIỆU!** Hệ thống đã kết nối trở lại.", true, "CONNECT_RECOVERY");
                isOfflineNotified = false;
            }

            // KIỂM TRA ĐẠT MỤC TIÊU LƯU LƯỢNG 

            if (activeSessionLimit > 0 && currentSystemState.status === "ON") {
                // Tính lượng nước thực tế đã bơm được 
                const pumpedInSession = parseFloat(currentSystemState.total_m3) - startSessionTotalM3;
                
                // Nếu đã đủ nước
                if (pumpedInSession >= activeSessionLimit) {
                    client.publish(TOPIC_CONTROL, JSON.stringify({ command: "CMD_STOP" }));
                    
                    sendTelegramMsg(`✅ **ĐỦ NƯỚC - TỰ ĐỘNG NGẮT**\nLượng nước đã bơm trong phiên: ${pumpedInSession.toFixed(2)} m³\n(Mục tiêu: ${activeSessionLimit} m³)`);
                    
                    activeSessionLimit = 0; 
                }
            }
 


            // 1. CẢNH BÁO DỪNG BƠM
            if (previousStatus === "ON" && currentSystemState.status === "OFF") {
                sendTelegramMsg(`⚠️ **BƠM ĐÃ DỪNG HOẠT ĐỘNG!**\nTrạng thái chuyển từ CHẠY sang DỪNG.\nÁp suất cuối: ${currentSystemState.pressure} Bar`, true, "ERR_PUMP_STOP");
            }
            previousStatus = currentSystemState.status;

            // 2. CẢNH BÁO MẤT ÁP SUẤT
            if (currentSystemState.status === "ON" && currentSystemState.pressure <= 0) {
                sendTelegramMsg(`⚠️ **MẤT ÁP SUẤT!**\nBơm đang chạy nhưng Áp suất tụt xuống ${currentSystemState.pressure} Bar.`, true, "ERR_PRESSURE");
           }

            // 3. CẢNH BÁO LỖI BIẾN TẦN
            if (currentSystemState.status === "ON" && currentSystemState.real_freq <= 0) {
                sendTelegramMsg("⚠️ **LỖI BIẾN TẦN!**\nTrạng thái là CHẠY (ON) nhưng Tần số thực tế về 0Hz.", true, "ERR_INVERTER");
            }

            // 4. CẢNH BÁO TẦN SỐ QUÁ CAO
            if (currentSystemState.real_freq > 40) {
                sendTelegramMsg(`⚠️ **TẦN SỐ CAO BẤT THƯỜNG!**\nHệ thống đang chạy: ${currentSystemState.real_freq}Hz (Mức khuyến nghị: 40Hz).`, true, "ERR_FREQ_HIGH");
            }
          

 
            //  LƯU LỊCH SỬ TỐI ƯU VÀO Ổ CỨNG
            
            // 1. Kiểm tra biến động 
            const freqDiff = Math.abs(currentSystemState.real_freq - lastSavedFreq) >= 0.2;
            const pressDiff = Math.abs(currentSystemState.pressure - lastSavedPressure) >= 0.1;

            // 2. Kiểm tra thời gian 
            const timeDiff = (now - lastSavedTime) >= TIME_HEARTBEAT;

          
            if (freqDiff || pressDiff || timeDiff) {
                const nowVN = new Date();
                const timeLabel = nowVN.toLocaleTimeString('vi-VN', { 
                    hour12: false,
                    timeZone: 'Asia/Ho_Chi_Minh'
                });

                historyData.push({
                    time: timeLabel,
                    pressure: currentSystemState.pressure,
                    real_freq: currentSystemState.real_freq,
                    set_freq: currentSystemState.set_freq,
                    flow: currentSystemState.flow 
                });

                // Cập nhật mốc so sánh
                lastSavedFreq = currentSystemState.real_freq;
                lastSavedPressure = currentSystemState.pressure;
                lastSavedTime = now;

                // Giới hạn mảng
                if (historyData.length > MAX_HISTORY) historyData.shift(); 
            }

            // LƯU TOÀN BỘ DỮ LIỆU XUỐNG Ổ CỨNG SAU MỖI LẦN CẬP NHẬT
            saveAllDataToDisk();

        } catch (e) {
            console.error("⚠️ Lỗi phân tích JSON:", e.message);
        }
    }
});


// 4. CÁC TÁC VỤ CHẠY NGẦM 


// A. Kiểm tra mất kết nối 
setInterval(() => {
    const timeSinceLastMessage = Date.now() - lastMqttMessageTime;

    // Nếu quá 10 giây không thấy tín hiệu
    if (timeSinceLastMessage > MAX_SILENCE_MS) {
        currentSystemState.system_status = "OFFLINE";
        
        currentSystemState.pressure = 0.0;
        currentSystemState.voltage = 0.0;
        currentSystemState.flow = 0.0;
        currentSystemState.real_freq = 0.0;
        currentSystemState.status = "OFF"; 
      
        if (!isOfflineNotified) {
            sendTelegramMsg("❌ **MẤT KẾT NỐI!**\nServer không nhận được dữ liệu từ Hệ Thống.\n(Kiểm tra nguồn điện hoặc Internet)", true);
            isOfflineNotified = true;
        }
    } else {
        currentSystemState.system_status = "ON";
    }
}, 5000);

// B. Báo cáo định kỳ (Chạy mỗi 10 giây để kiểm tra giờ)
let lastReportMinute = -1; // Biến nhớ phút đã báo cáo

setInterval(() => {
    // Lấy giờ VN chuẩn
    const nowVNStr = new Date().toLocaleString("en-US", {timeZone: "Asia/Ho_Chi_Minh"});
    const nowVN = new Date(nowVNStr);
    const hour = nowVN.getHours();
    const minute = nowVN.getMinutes();

    // [LOGIC] Báo cáo lúc 6:00, 12:00 và 18:00
    if ((hour === 6 || hour === 12 || hour === 18 ) && minute === 0) {
        if (lastReportMinute !== minute) { // Chỉ gửi 1 lần trong phút thứ 0
            
            const statusIcon = currentSystemState.system_status === "ON" ? "✅" : "❌";
            const runIcon = currentSystemState.status === "ON" ? "🟢" : "🔴";
            
            const reportMsg = `
            --------------------------------
            ${statusIcon} **Kết nối:** ${currentSystemState.system_status}
            ${runIcon} **Trạng thái:** ${currentSystemState.status}
            🌊 **Áp suất:** ${currentSystemState.pressure} Bar
            💧 **Lưu lượng:** ${currentSystemState.flow} m³/h
            📈 **Tổng dùng:** ${currentSystemState.total_m3} m³
            ⚡ **Tần số:** ${currentSystemState.real_freq} Hz
            🔋 **Điện áp:** ${currentSystemState.voltage} V
            --------------------------------
            Hệ thống hoạt động bình thường.
            `;
            
            sendTelegramMsg(reportMsg, false); // isAlert = false để gửi ngay
            lastReportMinute = minute;
        }
    } else {
        lastReportMinute = -1; // Reset khi qua phút khác
    }
}, 10000); 

// C. LOGIC BÁM ĐUỔI LỊCH (MASTER CONTROL) - Chạy mỗi 60 giây
setInterval(() => {
    const now = new Date();
    const currentHour = now.getHours();
    const currentMin = now.getMinutes();
    
    
    
    // Quy đổi thời gian hiện tại ra "Tổng số phút trong ngày" (0 - 1439)
    const currentTotalMins = currentHour * 60 + currentMin;
    
    // Lấy ngày chuẩn yyyy-mm-dd
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, '0');
    const d = String(now.getDate()).padStart(2, '0');
    const todayStr = `${y}-${m}-${d}`; 

    schedules.forEach(sched => {
        // 1. KIỂM TRA KHÓA 
        if (isAllSchedulesLocked === true || sched.isLocked === true) return;

        // 2. PHÂN TÍCH THỜI GIAN BẮT ĐẦU & KẾT THÚC
        const [sDate, sTime] = sched.startTime.split('T');
        const [sH, sM] = sTime.split(':').map(Number);
        
        const [eDate, eTime] = sched.endTime.split('T');
        const [eH, eM] = eTime.split(':').map(Number);

        // Quy đổi ra tổng phút để so sánh khoảng
        const startTotalMins = sH * 60 + sM;
        const endTotalMins = eH * 60 + eM;

        // 3. LOGIC KIỂM TRA NGÀY (DATE)
        // Nếu lặp hàng ngày thì Luôn đúng. Nếu không lặp thì Phải đúng ngày Start
        const isDateValid = (sched.repeat == 1) || (sDate === todayStr);

        // 4. LOGIC KIỂM TRA GIỜ 
        // Điều kiện: Thời gian hiện tại nằm lọt thỏm trong khoảng Start và End
        const isInTimeRange = (currentTotalMins >= startTotalMins) && (currentTotalMins < endTotalMins);
        
        // 5. XỬ LÝ KÍCH HOẠT & TỰ ĐỘNG PHỤC HỒI 
        if (isDateValid && isInTimeRange) {
            
          
            const isManualOverrideActive = (Date.now() - manualStopTimestamp) < OVERRIDE_DURATION;
            

            if (isManualOverrideActive) {
                return; 
            }

            // LOGIC GỬI LỆNH
            const isPumpOff = (currentSystemState.status === "OFF");
            const isFreqWrong = Math.abs(currentSystemState.real_freq - parseFloat(sched.freq)) > 1.0;

            if (isPumpOff || isFreqWrong) {
                console.log(`[MASTER-RECOVERY] Kích hoạt lại lịch ${sH}:${sM} @ ${sched.freq}Hz`);
                
                // Gửi lệnh SET TẦN SỐ trước
                client.publish(TOPIC_CONTROL, JSON.stringify({
                    command: "SET_FREQ",
                    value: parseFloat(sched.freq)
                }));

                // Gửi lệnh CHẠY 
                setTimeout(() => {
                     client.publish(TOPIC_CONTROL, JSON.stringify({ command: "CMD_RUN" }));
                }, 200);

                // Setup giới hạn lưu lượng 
                if (activeSessionLimit === 0 && sched.limitM3 > 0) {
                    activeSessionLimit = parseFloat(sched.limitM3);
                    startSessionTotalM3 = parseFloat(currentSystemState.total_m3);
                    sendTelegramMsg(`🔄 **BÁM ĐUỔI LỊCH**\nPhát hiện lịch trình đang diễn ra (${sH}:${sM}).\nĐã kích hoạt bơm lại!`);
                }
            }
        }
        
      // 6. XỬ LÝ KẾT THÚC 
        if (isDateValid && currentTotalMins === endTotalMins) {
             
             // Lấy chế độ mong muốn sau khi hết lịch 
             const desiredMode = sched.finalMode; 

             //  Cài đặt là về AUTO 
             if (desiredMode === 'MODE_AUTO') {
 
                 if (currentSystemState.mode !== 'AUTO' && currentSystemState.mode !== 'MODE_AUTO') {
                     console.log(`[MASTER] Kết thúc lịch ${eH}:${eM}. Chuyển sang AUTO.`);
                     
                     // Gửi lệnh chuyển sang chế độ AUTO
                     client.publish(TOPIC_CONTROL, JSON.stringify({ command: "MODE_AUTO" }));
                     
                     sendTelegramMsg(`🔄 **KẾT THÚC LỊCH**\nHệ thống chuyển sang chế độ TỰ ĐỘNG (AUTO).`);
                 }
             } 
             // Cài đặt là DỪNG HẲN 
             else {
                 // Chỉ gửi lệnh Dừng nếu bơm đang còn CHẠY
                 if (currentSystemState.status === "ON") {
                     console.log(`[MASTER] Kết thúc lịch ${eH}:${eM}. Gửi lệnh DỪNG.`);
                     client.publish(TOPIC_CONTROL, JSON.stringify({ command: "CMD_STOP" }));
                     sendTelegramMsg(`🛑 **KẾT THÚC LỊCH**\nĐã đến giờ dừng theo lịch trình.`);
                 }
             }
        }
    });
}, 5000); 

// 5. API VÀ KHỞI ĐỘNG
// hàm gửi lên google sheet
async function syncToGoogleSheet(payload) {
    if (!GAS_APP_URL) return;
    try {
        const response = await fetch(GAS_APP_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        const txt = await response.text();
        console.log(`📤 [SYNC-SHEET] Kết quả: ${txt}`);
    } catch (e) {
        console.error("❌ Lỗi đồng bộ Google Sheet:", e.message);
    }
}


app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'monitor.html')); 
});

app.post('/api/control', (req, res) => {
    const { command, value } = req.body;
    
    // Ghi nhận hành động DỪNG/CHẠY của người dùng
    if (command === 'CMD_STOP') {
        manualStopTimestamp = Date.now(); 
        console.log(`🛑 [USER] Dừng khẩn cấp. Tạm dừng lịch tự động trong ${OVERRIDE_DURATION/60000} phút.`);
        
        sendTelegramMsg(`🚨 **DỪNG KHẨN CẤP!**\nNgười dùng đã tắt bơm.\nHệ thống sẽ không tự bật lại trong ${OVERRIDE_DURATION/60000} phút.`, true);
    } 
    else if (command === 'CMD_RUN') {
        manualStopTimestamp = 0; 
        console.log("▶️ [USER] Đã nhấn Chạy. Hủy bỏ chế độ ưu tiên dừng.");
    }

    const payload = JSON.stringify({ command, value });
    client.publish(TOPIC_CONTROL, payload, (err) => { //đẩy lên mqqt
        if (err) {
            res.status(500).json({ status: "error" });
        } else {
            console.log(`📤 Lệnh: ${payload}`);
            res.json({ status: "success" });
        }
    });
});

// API CHAT CHO WEB
app.post('/api/chat', (req, res) => {
    const userMsg = req.body.message || "";
    if (userMsg !== "__CHECK_NOTIFICATIONS__") {
        console.log(`💬 [WEB CHAT]: ${userMsg}`);
    }
    
    if (userMsg === "__CHECK_NOTIFICATIONS__") {
        const notifications = [...webChatNotifications];
        webChatNotifications = []; 
        return res.json({ notifications: notifications });
    }

    let reply = processSystemQuery(userMsg);
    if (!reply) {
        reply = "Chào sếp! 🫢\nSếp muốn biết thông tin nào?\n\n- **thông tin sinh viên**\n- **thông số trạm bơm**\n- **lưu lượng**\n- **tần số**\n- **áp suất**\n- **điện áp**\n- **trạng thái**\n- **lịch trình**\n- **ngày tháng năm** \n- **Dữ liệu hôm qua** \n\nTôi sẽ cho sếp biết ngay! 😁";
    }
    reply = reply.replace(/\{IMAGE:(.*?)\}/, '<img src="$1" style="width:100%; border-radius:10px; margin-bottom:10px;">');
    reply = reply.replace(/\n/g, '<br>').replace(/\*\*/g, '');
    reply = reply.replace(/\n/g, '<br>').replace(/\*\*/g, ''); 
    res.json({ reply: reply });
});

app.get('/api/data', (req, res) => {
    res.json(currentSystemState);
});

app.get('/api/history', (req, res) => {
    res.json(historyData);
});

app.get('/api/schedules', (req, res) => {
    res.json(schedules);
});

// API Lấy dữ liệu tiêu thụ nước trong ngày 
app.get('/api/daily-usage', (req, res) => {
    res.json(dailyStats);
});

// API Lịch gửi sang Google Sheet
app.post('/api/schedules', (req, res) => {
    const { startTime, endTime, freq, action, finalMode, repeat, limitM3 } = req.body;
    
    if (schedules.length >= 10) schedules.shift(); 
    
    // Lưu thuộc tính tổng lưu lượng vào database
    const newSchedule = { 
        id: Date.now(), 
        startTime, 
        endTime, 
        freq, 
        action: action || "RUN", 
        finalMode: finalMode || "MODE_AUTO",
        repeat: parseInt(repeat) || 0,
        limitM3: parseFloat(limitM3) || 0,
        isLocked: false 
    };
    
    schedules.push(newSchedule);
    saveToDisk(); 
    
    console.log(`📅 Đã lên lịch mới trên Server: ${startTime} -> ${endTime}`);

    // GỌI HÀM ĐỒNG BỘ SANG GOOGLE SHEET
    syncToGoogleSheet({
        type: "schedule_sync",
        action: "add",
        schedule: newSchedule
    });

    res.json({ status: "success", schedule: newSchedule });
});

//  API Xóa Lịch 
app.delete('/api/schedules/:id', (req, res) => {
    const id = parseInt(req.params.id);
    

    const exists = schedules.find(s => s.id === id);

    schedules = schedules.filter(s => s.id !== id);
    saveToDisk(); 
    
    console.log(`🗑️ Đã xóa lịch ID: ${id} trên Server.`);

    if (exists) {
        //  GỬI LỆNH XÓA GOOGLE SHEET
        syncToGoogleSheet({
            type: "schedule_sync",
            action: "delete",
            id: id
        });
    }

    res.json({ status: "success" });
});


// 1. API Khóa/Mở khóa toàn bộ
app.post('/api/schedules/lock-all', (req, res) => {
    isAllSchedulesLocked = req.body.locked;
    console.log(`[LOCK] Đã ${isAllSchedulesLocked ? "KHÓA" : "MỞ"} toàn bộ lịch trình.`);
    res.json({ status: "success", isAllSchedulesLocked });
});

// 2. API Khóa/Mở khóa từng lịch lẻ
app.post('/api/schedules/:id/lock', (req, res) => {
    const id = parseInt(req.params.id);
    const sched = schedules.find(s => s.id === id);
    if (sched) {
        sched.isLocked = req.body.locked;
        saveToDisk(); // Lưu trạng thái khóa vào file json
        console.log(`[LOCK] Đã ${sched.isLocked ? "KHÓA" : "MỞ"} lịch ID: ${id}`);
        res.json({ status: "success" });
    } else {
        res.status(404).json({ status: "error" });
    }
});

// 3. API Lấy trạng thái khóa tổng 
app.get('/api/schedules-status', (req, res) => {
    res.json({ isAllSchedulesLocked });
});
// -------------------------------------------------------

app.listen(port, () => {
    console.log(`🚀 Web Server đang chạy tại: http://localhost:${port}`);
});


const readline = require('readline');
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  terminal: false
});

rl.on('line', (line) => {
    if (line.trim() === "") return;

  
    if (typeof webChatNotifications !== 'undefined') {
        webChatNotifications.push(`[ADMIN_MSG]${line}`); 
        console.log(`✅ Đã gửi phản hồi: ${line}`);
    }
});

//  BỘ NÃO GIÁM SÁT LỊCH TRÌNH TỰ ĐỘNG
let notifiedSchedules = new Set(); 
let lastResetHour = new Date().getHours(); 

setInterval(() => {
    const now = new Date();
    const currentHour = now.getHours(); 
    const currentTimeStr = now.getHours().toString().padStart(2, '0') + ":" + now.getMinutes().toString().padStart(2, '0');
    const todayStr = now.getFullYear() + "-" + (now.getMonth() + 1).toString().padStart(2, '0') + "-" + now.getDate().toString().padStart(2, '0');


    if (currentHour !== lastResetHour) {
        notifiedSchedules.clear();
        lastResetHour = currentHour;
        console.log(`[HỆ THỐNG] Đã reset bộ nhớ thông báo cho giờ mới: ${currentHour}h`);
    }


    for (let key of notifiedSchedules) {
        const idFromKey = key.split('_')[0];
        if (!schedules.find(s => s.id == idFromKey)) {
            notifiedSchedules.delete(key);
            console.log(`[HỆ THỐNG] Đã dọn dẹp bộ nhớ cho lịch ID: ${idFromKey} (vừa bị xóa)`);
        }
    }
    
    schedules.forEach(s => {
        if (s.isLocked || isAllSchedulesLocked) return;

        const [sDate, sTime] = s.startTime.split('T');
        const isToday = (s.repeat == 1) || (sDate === todayStr);
        if (!isToday) return;

        const key = `${s.id}_${currentTimeStr}`;

        // 1. THÔNG BÁO KHI ĐẾN GIỜ CHẠY
        if (sTime === currentTimeStr && !notifiedSchedules.has(key)) {
            const msg = `🚀 **HỆ THỐNG BẮT ĐẦU CHẠY**\n⏰ Lịch trình: ${sTime}\n⚡ Tần số: ${s.freq} Hz\n💧 Lưu lượng dự tính: ${s.limitM3 || 0} m³`;
            sendTelegramMsg(msg, false); 
            notifiedSchedules.add(key);
        }

        // 2. THÔNG BÁO SẮP CHẠY trước 5 phút
        const [sh, sm] = sTime.split(':').map(Number);
        const startTotalMin = sh * 60 + sm;
        const currentTotalMin = now.getHours() * 60 + now.getMinutes();

        if (startTotalMin - currentTotalMin === 5 && !notifiedSchedules.has(key + "_pre")) {
            const msg = `🔔 **NHẮC NHỞ LỊCH TRÌNH**\nLịch trình lúc **${sTime}** sẽ bắt đầu sau 5 phút nữa sếp nhé!\n⚡ Tần số đặt: ${s.freq} Hz\n💧 lưu lượng dự kiến: ${s.limitM3 || 0} m³`;
            sendTelegramMsg(msg, false);
            notifiedSchedules.add(key + "_pre");
        }
    });

}, 30000); 