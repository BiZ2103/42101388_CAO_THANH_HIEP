#include <Wire.h>
#include <ModbusMaster.h>
#include <Keypad.h>
#include <WiFi.h>
#include <time.h>
#include <freertos/task.h> 
#include <U8g2lib.h>
#include <SPI.h> 
#include <cmath> 
#include <HTTPClient.h> 
#include <ESPmDNS.h>    
#include <Update.h>      
#include <Ticker.h>      
#include <ArduinoOTA.h>
#include <PubSubClient.h> 
#include <DNSServer.h>
#include <WebServer.h>
#include <WiFiManager.h> 
#include <ArduinoJson.h> 
#include <esp_task_wdt.h> 


//  CẤU HÌNH MQTT SERVER 
const char* MQTT_SERVER = "phuongnamdts.com";
const int MQTT_PORT = 4783;
const char* MQTT_USER = "baonammqtt";
const char* MQTT_PASS = "mqtt@d1git";
const char* MQTT_TOPIC_PUB = "esp32/pump/data";
const char* MQTT_TOPIC_SUB = "esp32/pump/control";   

WiFiClient espClient;
PubSubClient mqttClient(espClient);
unsigned long lastMqttSend = 0;
const long mqttSendInterval = 5000;

// CẤU HÌNH WEB SERVER VÀ OTA 
WebServer server(80);
Ticker tkSecond;
uint8_t otaDone = 0;
const char *authUser = "admin";
const char *authPass = "5555";
const char *csrfHeaders[2] = {"Origin", "Host"};
static bool authenticated = false;

//  GIAO DIỆN WEB NỘI BỘ
const char* HTML_CONTENT = R"raw(
<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1, user-scalable=no">
    <title>ĐIỀU KHIỂN BƠM ESP32 - SLAVE MODE</title>
    <style>
        body { font-family: 'Inter', sans-serif; max-width: 600px; margin: auto; padding: 10px; background: #1e1e1e; color: #f0f0f0; line-height: 1.5; }
        .container { background: #252526; padding: 20px; border-radius: 12px; box-shadow: 0 4px 15px rgba(0, 0, 0, 0.5); }
        h2 { text-align: center; color: #4CAF50; border-bottom: 2px solid #333; padding-bottom: 10px; margin-bottom: 20px; }
        .section-box { background: #2d2d30; padding: 15px; border-radius: 8px; margin-bottom: 15px; border-left: 5px solid #007ACC; }
        .section-title { font-size: 1.2em; font-weight: bold; color: #007ACC; margin-bottom: 10px; }
        .status-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 15px; font-size: 0.95em; }
        .status-item { background: #333333; padding: 12px; border-radius: 6px; box-shadow: 0 2px 5px rgba(0, 0, 0, 0.3); }
        .label { font-weight: bold; color: #aaaaaa; display: block; margin-bottom: 3px; }
        .value { font-size: 1.2em; font-weight: bold; color: #f0f0f0; }
        .val-highlight { color: #FFD700; } .val-green { color: #4CAF50; } .val-red { color: #FF6347; } .val-blue { color: #00BFFF; }
        .set-freq-area { text-align: center; padding: 15px; border-radius: 8px; background: #333333; }
        .input-group { display: flex; justify-content: center; align-items: center; margin-top: 10px; }
        input[type="number"] { width: 80px; padding: 10px; margin: 0 10px; border: 1px solid #555; border-radius: 4px; text-align: center; font-size: 1.1em; background: #444; color: #f0f0f0; }
        button { padding: 10px 18px; margin: 5px; border: none; border-radius: 6px; cursor: pointer; color: white; font-weight: bold; transition: background 0.2s, transform 0.1s; }
        button:active { transform: scale(0.98); }
        .btn-chay { background: #4CAF50; } .btn-chay:hover { background: #45a049; }
        .btn-dung { background: #FF6347; } .btn-dung:hover { background: #e5533d; }
        .btn-set-freq { background: #007ACC; width: 150px; } .btn-set-freq:hover { background: #006bbd; }
        .btn-mode { background: #555; width: 120px; } .btn-mode:hover { background: #666; }
        .btn-ota { background: #8A2BE2; width: 100%; margin-top: 15px; } .btn-ota:hover { background: #7a1fd1; }
        .footer { text-align: center; margin-top: 20px; font-size: 0.8em; color: #666; }
    </style>
</head>
<body>
    <div class="container">
        <h2>PUMP CONTROL SYSTEM</h2>
        <div class="section-box">
            <div class="section-title">TRẠNG THÁI VÀ CẢM BIẾN</div>
            <div class="status-grid">
                <div class="status-item"><span class="label">Tần số Đặt:</span><span id="sfVal" class="value val-blue">...</span> Hz</div>
                <div class="status-item"><span class="label">Tần số Thực:</span><span id="afVal" class="value val-highlight">...</span> Hz</div>
                <div class="status-item"><span class="label">Trạng thái:</span><span id="runStatus" class="value val-green">...</span></div>
                <div class="status-item"><span class="label">Chế độ:</span><span id="modeStatus" class="value val-highlight">...</span></div>
                <div class="status-item"><span class="label">Áp suất:</span><span id="pVal" class="value val-red">...</span> Bar</div>
                <div class="status-item"><span class="label">Lưu lượng:</span><span id="flowVal" class="value val-blue">...</span> m&sup3;/h</div>
                <div class="status-item"><span class="label">Điện áp CH1:</span><span id="vVal" class="value val-red">...</span> V</div>
            </div>
        </div>
        
        <div class="section-box" style="border-left: 5px solid #FFD700;">
            <div class="section-title" style="color:#FFD700;">ĐIỀU KHIỂN (MANUAL/AUTO)</div>
            <div class="set-freq-area">
                <div class="label">ĐẶT TẦN SỐ (Hz)</div>
                <div class="input-group">
                    <button class="btn-mode" onclick="adj(-1)">▼ -1</button> 
                    <input type="number" id="freqInput" value="0.0" step="0.1" min="0" max="50"> 
                    <button class="btn-mode" onclick="adj(1)">▲ +1</button> 
                </div>
                <button class="btn-set-freq" onclick="setF()">GỬI TẦN SỐ</button>
            </div>
            <div style="text-align:center; margin-top:15px; display:flex; justify-content:space-around;">
                <button class="btn-chay" onclick="ctrl(1)">CHẠY</button>
                <button class="btn-dung" onclick="ctrl(0)">DỪNG</button>
            </div>
            <div style="text-align:center; margin-top:10px; display:flex; justify-content:space-around;">
                <button class="btn-mode" onclick="sMode('MANUAL')">THỦ CÔNG</button>
                <button class="btn-mode" onclick="sMode('AUTO')">TỰ ĐỘNG</button>
            </div>
        </div>
        <div class="section-box" style="border-left: 5px solid #FF6347;">
             <div class="section-title" style="color:#FF6347;">CẬP NHẬT HỆ THỐNG</div>
             <button class="btn-ota" onclick="location.href='/update'">CẬP NHẬT FIRMWARE (OTA)</button>
        </div>
        <div class="footer"><span style="color:#FFD700;">IP ADDRESS:</span> <span id="ip">...</span></div>
    </div>
    <script>
        document.getElementById('ip').innerText = window.location.host;
        function ctrl(s) { fetch('/set/run?s=' + s); }
        function sMode(m) { fetch('/set/mode?v=' + m); }
        function setF() { fetch('/set/freq?v=' + document.getElementById('freqInput').value); }
        function adj(v) { 
            var cur = parseFloat(document.getElementById('freqInput').value) || 0;
            var newVal = Math.max(0, Math.min(50, cur + v)); 
            document.getElementById('freqInput').value = newVal.toFixed(1);
        }
        setInterval(() => {
            fetch('/data').then(r => r.json()).then(d => {
                var st = document.getElementById('runStatus');
                st.innerText = d.run ? "CHẠY" : "DỪNG";
                st.className = 'value ' + (d.run ? 'val-green' : 'val-red');
                document.getElementById('modeStatus').innerText = d.mode;
                document.getElementById('pVal').innerText = d.p;
                document.getElementById('flowVal').innerText = d.flow; 
                document.getElementById('afVal').innerText = d.af;
                document.getElementById('sfVal').innerText = d.sf;
                document.getElementById('vVal').innerText = d.v;
                if(document.activeElement.id !== "freqInput") {
                    document.getElementById('freqInput').value = d.sf;
                }
            });
        }, 1500);
    </script>
</body>
</html>
)raw";

// CẤU HÌNH RS485 & I/O
#define VFD_DE_RE 14        
#define SENSOR_DE_RE 13     
#define VFD_RX 16
#define VFD_TX 15
#define SENSOR_RX 42
#define SENSOR_TX 41
#define VFD_ID 2
#define SENSOR_ID 1         
#define REG_RUN_STOP 0x2000
#define REG_FREQUENCY 0x2001
#define REG_ACTUAL_FREQ 0x3000
#define WDT_TIMEOUT 10

ModbusMaster nodeVFD;
ModbusMaster nodeSensor; 	

// CẤU HÌNH LCD (U8G2) 
#define CUSTOM_SDA_PIN 36 
#define CUSTOM_SCL_PIN 35 
#define LCD_ADDRESS (0x3F * 2) 

U8G2_ST7567_ENH_DG128064I_1_HW_I2C u8g2(U8G2_R2, CUSTOM_SCL_PIN, CUSTOM_SDA_PIN, U8X8_PIN_NONE);
TaskHandle_t displayTaskHandle = NULL;

// ========================== 5. CẤU HÌNH KEYPAD ==========================
const byte ROWS = 5;
const byte COLS = 4;
char keys[ROWS][COLS] = {
	{'F', 'G', '#', '*'},
	{'1', '2', '3', 'L'},
	{'4', '5', '6', 'X'},
	{'7', '8', '9', 'E'},
	{'<', '0', '>', 'R'}
};
byte rowPins[ROWS] = {8, 7, 6, 5, 4};
byte colPins[COLS] = {9, 10, 11, 12};
Keypad keypad = Keypad(makeKeymap(keys), rowPins, colPins, ROWS, COLS);

//  BIẾN TOÀN CỤC HỆ THỐNG
enum Mode { NONE, MANUAL, AUTO, INPUT_FREQ };
Mode mode = NONE;

String password = "";
const String correctPassword = "5555";
bool isAuthenticated = true;
String inputFreq = "";
float freq = 0;
bool running = false;



volatile float pendingFreq = -1.0; 
volatile int pendingRun = -1; 

unsigned long lastSensorRead = 0;
const unsigned long sensorInterval = 1000;
unsigned long lastSerialPrint = 0;
const unsigned long serialPrintInterval = 5000;
float voltage = -2.0;
float pressure = -2.0;
float actualFreq = -1.0;
float estimatedFlow = 0.0;

const char* GAS_URL = "https://script.google.com/macros/s/AKfycbz7FfMnGmtgBlBcAgFWGW4MEDSIs7i8iSCuzHCwI0_m7kDjYxw0xnT7US9e9HiT_3-X/exec";
unsigned long lastHttpSend = 0;
const long httpSendInterval = 60000;
unsigned long lastAutoCheck = 0;
const unsigned long autoCheckInterval = 2000; 

struct tm timeinfo;
bool useNTP = false;
unsigned long systemStartTime = 0;
float locationLat = 10.73;
float locationLon = 106.700;

// - BIẾN WIFI
bool inConfigurationMode = false;
bool wifiAttemptDone = false;
unsigned long G_press_start_time = 0;
const unsigned long forceAPHoldTime = 5000;
WiFiManager wm;

//  KHAI BÁO HÀM 
void TaskModbusAndAuto(void * parameter);
void TaskLCD(void * parameter);
void handleEmergencyStop();
void handlePassword(char k);
void handleModeSelection(char k);
void handleInputFrequency(char k); 
void handleManual(char k); 
void handleAuto();
void applyAutoModeState(); 


void requestSetFrequency(float hz);
void requestSetRun(bool state);
void executeSetFrequency(float hz);
void executeSetRun(bool state);

float readActualFrequency();
void readSensor();
void printSerialData();
String getTimeString();
void preTransmission();
void postTransmission();
void preTransmissionSensor();
void postTransmissionSensor();
void trySyncNTP();
String getDateString();
void sendDataToGoogleSheet();
void setupWifi();
void handleForceAP(char k); 
void setupWebServer();
void handleRoot();
void handleData();
void handleSetRun();
void handleSetFreq();
void handleSetMode();
void handleUpdateEnd();
void handleUpdate();
void everySecond();
void reconnectMqtt();
void sendDataToMqtt();
void mqttCallback(char* topic, byte* payload, unsigned int length);

// LOGIC HỆ THỐNG
void requestSetFrequency(float hz) {
    freq = hz; 
    pendingFreq = hz; 
    Serial.printf(">> Request Freq: %.1f Hz\n", hz);
}

void requestSetRun(bool state) {
    running = state; 
    pendingRun = state ? 1 : 0; // Đẩy vào hàng đợi
    Serial.printf(">> Request Run: %d\n", state);
}

void executeSetFrequency(float hz) {
	uint16_t val = (uint16_t)(hz * 100);
	uint8_t res = nodeVFD.writeSingleRegister(REG_FREQUENCY, val);
	if (res == nodeVFD.ku8MBSuccess) Serial.printf("[VFD] Write Freq OK: %.1f Hz\n", hz);
	else Serial.printf("[VFD] Write Freq FAIL: 0x%02X\n", res);
}

void executeSetRun(bool state) {
	uint8_t res = nodeVFD.writeSingleRegister(REG_RUN_STOP, state ? 1 : 0);
	if (res == nodeVFD.ku8MBSuccess) Serial.printf("[VFD] Write %s OK\n", state ? "RUN" : "STOP");
    else Serial.printf("[VFD] Write Run/Stop FAIL: 0x%02X\n", res);
}

// -----------------------------------------------------------------

String getDateString() {
	if (useNTP && getLocalTime(&timeinfo)) {
		char buf[12];
		strftime(buf, sizeof(buf), "%d/%m/%Y", &timeinfo);
		return String(buf);
	}
    return "Loading...";
}

void preTransmission() { 
    digitalWrite(VFD_DE_RE, HIGH); delayMicroseconds(500);
}
void postTransmission() { 
    delayMicroseconds(500); digitalWrite(VFD_DE_RE, LOW);
}
void preTransmissionSensor() { 
    digitalWrite(SENSOR_DE_RE, HIGH); delayMicroseconds(500);
} 
void postTransmissionSensor() { 
    delayMicroseconds(500);
    digitalWrite(SENSOR_DE_RE, LOW);
} 

void trySyncNTP() {
	if (WiFi.status() != WL_CONNECTED) return;
	Serial.print(F("Dong bo NTP"));
	configTime(7 * 3600, 0, "time.google.com", "time.windows.com", "pool.ntp.org");
	uint8_t attempts = 0;
	while (attempts < 30) {
        esp_task_wdt_reset();
		if (getLocalTime(&timeinfo)) {
			Serial.println(F(" THANH CONG!"));
			useNTP = true;
			Serial.printf("Gio NTP: %02d:%02d:%02d\n", timeinfo.tm_hour, timeinfo.tm_min, timeinfo.tm_sec);
			return;
		}
		delay(500); Serial.print("."); attempts++;
	}
	Serial.println(F("\nTHAT BAI"));
	useNTP = false;
}

String getTimeString() {
	if (useNTP && getLocalTime(&timeinfo)) {
		char buf[9];
		sprintf(buf, "%02d:%02d:%02d", timeinfo.tm_hour, timeinfo.tm_min, timeinfo.tm_sec);
		return String(buf);
	} else {
		unsigned long sec = (millis() - systemStartTime) / 1000;
		char buf[12];
		sprintf(buf, "Up %02d:%02d:%02d", sec/3600, (sec%3600)/60, sec%60);
		return String(buf);
	}
}

float readActualFrequency() {
	if (nodeVFD.readHoldingRegisters(REG_ACTUAL_FREQ, 1) == nodeVFD.ku8MBSuccess)
		return nodeVFD.getResponseBuffer(0) / 100.0;
	return -1.0;
}

//  HÀM ĐỌC CẢM BIẾN VÀ TÍNH LƯU LƯỢNG GIẢ LẬP
void readSensor() {
	float total = 0;
	int ok = 0;
	bool anySuccess = false;
    if (nodeSensor.readHoldingRegisters(0x0000, 1) == nodeSensor.ku8MBSuccess) {
		anySuccess = true;
		uint16_t v = nodeSensor.getResponseBuffer(0);
		if (v >= 0 && v <= 550) { 
			total = v * 0.01; ok = 1;
		}
	}
	if (ok > 0) {
		voltage = total;
		pressure = (voltage - 0.5) * 3.0;
		if (pressure < 0) pressure = 0;
		if (pressure > 12.0) pressure = 12.0;
        if (running && freq > 0) {
            float P_max = 3.0;
            float pressureRatio = pressure / P_max;
            if (pressureRatio > 1.0) pressureRatio = 1.0;
            float flowFactor = pow(1.0 - pressureRatio, 1.5);
            if (flowFactor < 0) flowFactor = 0;
            estimatedFlow = (8.0 * (freq / 50.0)) * flowFactor;
            if (estimatedFlow < 0) estimatedFlow = 0;
        } else {
            estimatedFlow = 0.0;
        }

	} else if (anySuccess) {
		voltage = pressure = -1.0;
        estimatedFlow = 0.0;
	} else {
		voltage = pressure = -2.0;
		estimatedFlow = 0.0;
	}
}

void mqttCallback(char* topic, byte* payload, unsigned int length) {
  String message = "";
  for (int i = 0; i < length; i++) message += (char)payload[i];
  Serial.print("📩 MQTT Nhận: "); Serial.println(message);

  StaticJsonDocument<1024> doc;
  DeserializationError error = deserializeJson(doc, message);

  if (!error) {
    const char* cmd = doc["command"];
    if (strcmp(cmd, "SET_FREQ") == 0) {
      float val = doc["value"];
      if (val >= 0 && val <= 50) { 
        requestSetFrequency(val); 
        mode = MANUAL; 
      }
    }
    else if (strcmp(cmd, "CMD_RUN") == 0) { 
      requestSetRun(true); 
      mode = MANUAL; 
    }
    else if (strcmp(cmd, "CMD_STOP") == 0) { 
      requestSetFrequency(0);
      requestSetRun(false); 
      mode = MANUAL;
    }
    else if (strcmp(cmd, "MODE_AUTO") == 0) { 
      mode = AUTO;
    }
    else if (strcmp(cmd, "MODE_MANUAL") == 0) { 
      mode = MANUAL;
    }
  } else {
    Serial.print("❌ Lỗi phân tích JSON: "); 
    Serial.println(error.c_str());
  }
}


void reconnectMqtt() {
    if (WiFi.status() != WL_CONNECTED) return;
    
  
    static unsigned long lastMqttRetry = 0;
    
    // Nếu chưa đủ 5 giây kể từ lần thử trước THÌ Thoát ngay, không làm gì cả
    if (millis() - lastMqttRetry < 5000) return;

    if (!mqttClient.connected()) {
        Serial.print("Dang ket noi MQTT (Non-blocking)...");
        lastMqttRetry = millis();
        
        String clientId = "ESP32-Pump-" + String(random(0xffff), HEX);
        
        // Thử kết nối 1 lần
        if (mqttClient.connect(clientId.c_str(), MQTT_USER, MQTT_PASS)) {
            Serial.println("Thanh cong!");
            mqttClient.subscribe(MQTT_TOPIC_SUB);
            mqttClient.publish(MQTT_TOPIC_PUB, "{\"system_event\":\"RECONNECTED\"}");
        } else {
            Serial.print("That bai, rc=");
            Serial.println(mqttClient.state());
        }
    }
}

void sendDataToMqtt() {
    if (millis() - lastMqttSend < mqttSendInterval) return;
    if (!mqttClient.connected()) return;
    String modeStr = (mode == AUTO ? "AUTO" : (mode == MANUAL ? "MANUAL" : "MENU"));
    String json = "{";
    json += "\"actual_freq\":" + String(actualFreq, 1) + ",";
    json += "\"set_freq\":" + String(freq, 1) + ",";
    json += "\"pressure\":" + String(pressure, 2) + ","; 
    json += "\"flow\":" + String(estimatedFlow, 2) + ",";
    json += "\"voltage\":" + String(voltage, 2) + ",";
    json += "\"running_status\":" + String(running ? "true" : "false") + ",";
    json += "\"control_mode\":\"" + modeStr + "\"";
    json += "}";

    if (mqttClient.publish(MQTT_TOPIC_PUB, json.c_str())) Serial.println("[MQTT] Da gui data");
    else Serial.println("[MQTT] Gui that bai.");
    lastMqttSend = millis();
}

void sendDataToGoogleSheet() {
    if (GAS_URL[0] == '\0' || WiFi.status() != WL_CONNECTED) return;
    if (millis() - lastHttpSend < httpSendInterval) return;

    float safeFreq = (actualFreq < 0) ? 0.0 : actualFreq;
    float safePressure = (pressure < 0) ? 0.0 : pressure;
    float safeVoltage = (voltage < 0) ? 0.0 : voltage;
    String statusStr = running ? "CHAY" : "DUNG";
    String modeStr = (mode == AUTO ? "TU DONG" : (mode == MANUAL ? "THU CONG" : "MENU"));
    HTTPClient http;
    http.begin(GAS_URL);
    http.addHeader("Content-Type", "application/json");

    String jsonPayload = "{";
    jsonPayload += "\"actual_freq\":" + String(safeFreq, 2) + ",";
    jsonPayload += "\"pressure\":" + String(safePressure, 2) + ",";
    jsonPayload += "\"voltage\":" + String(safeVoltage, 2) + ",";
    jsonPayload += "\"flow\":" + String(estimatedFlow, 2) + ",";
    jsonPayload += "\"control_mode_status\":\"" + modeStr + "\",";
    jsonPayload += "\"running_status\":\"" + statusStr + "\",";
    jsonPayload += "\"location\":{\"lat\":" + String(locationLat, 4) + ", \"lon\":" + String(locationLon, 4) + "}";
    jsonPayload += "}";
    int httpResponseCode = http.POST(jsonPayload);
    if (httpResponseCode > 0) Serial.printf("[HTTP] Gửi Sheets thành công: %d\n", httpResponseCode);
    else Serial.printf("[HTTP] Lỗi gửi Sheets: %s\n", http.errorToString(httpResponseCode).c_str());

    http.end();
    lastHttpSend = millis();
}

void printSerialData() {
	if (millis() - lastSerialPrint < serialPrintInterval) return;
	lastSerialPrint = millis();
    String dateStr = getDateString();
    String timeStr = getTimeString();
	Serial.println(F("\n════════════════════════════════════════"));
	Serial.printf(" %s | %s\n", dateStr.c_str(), timeStr.c_str());
	Serial.printf(" Tan số dat : %.2f Hz\n", freq);
	if (actualFreq >= 0) Serial.printf(" Tan số thuc te : %.2f Hz%s\n", actualFreq, std::fabs(actualFreq - freq) > 0.5 ? " ← CHUA DAT" : " ← DA DAT");
	else Serial.println(F(" Tan số thuc te : LOI DOC"));
	if (voltage == -2.0) { Serial.println(F(" Dien ap/Ap suat : KHÔNG CẢM BIẾN")); } 
    else if (voltage == -1.0) { Serial.println(F(" Dien ap/Ap suat : LOI GIA TRI")); } 
    else { 
        Serial.printf(F(" Dien ap CH1 : %.3f V\n"), voltage);
        Serial.printf(F(" Ap suat : %.3f Bar\n"), pressure); 
        Serial.printf(F(" Luu luong : %.2f m3/h\n"), estimatedFlow);
    }
	Serial.printf(F(" Che do : %s\n"), mode == MANUAL ? "THU CONG" : mode == AUTO ? "TU DONG" : mode == INPUT_FREQ ? "NHAP TAN SO" : "CHUA CHON");
	Serial.printf(F(" Trang thai : %s\n"), running ? "DANG CHAY" : "DUNG");
	Serial.println(F("════════════════════════════════════════\n"));
}

void handleEmergencyStop() {

    running = false; freq = 0;
	requestSetFrequency(0); 
    requestSetRun(false); 
    mode = MANUAL;
	Serial.println(F("[KEYPAD] DUNG KHAN CAP"));
}

void handlePassword(char k) { }

void handleModeSelection(char k) {
	if (!k) return;
	Serial.printf("Phím (Menu): [%c]\n", k);
    if (k=='1') { mode=MANUAL; Serial.println(F("[KEYPAD] Chon che do Thu cong.")); }
	else if (k=='2') { mode=AUTO; Serial.println(F("[KEYPAD] Chon che do Tu dong.")); }
	else if (k=='3') { mode=INPUT_FREQ; inputFreq=""; Serial.println(F("[KEYPAD] Chon che do Nhap tan so.")); }
	else if (k=='E') { handleEmergencyStop(); }
}

void handleInputFrequency(char k) {
	if (!k) return;
	Serial.printf("Phím (Input): [%c]\n", k);
    if (k>='0'&&k<='9' && inputFreq.length()<2) { inputFreq+=k; }
	else if (k=='<' && inputFreq.length()>0) { inputFreq.remove(inputFreq.length()-1); }
	else if (k=='R') {
		float f = inputFreq.length()==0 ? 0 : inputFreq.toFloat();
        if (f>=0 && f<=50) { 
         
            requestSetFrequency(f);
            inputFreq=""; mode=MANUAL;
            Serial.printf("[KEYPAD] Dat tan so: %.1f Hz\n", f); 
        }
		else { Serial.println(F("[KEYPAD] Tan số nhap khong hop le (>50Hz).")); inputFreq=""; }
	}
	else if (k=='F') { inputFreq=""; mode=NONE; Serial.println(F("[KEYPAD] Thoat nhap tan so.")); }
}

void handleManual(char k) {
	if (!k) return;
	Serial.printf("Phím (Manual): [%c]\n", k);
    switch(k){
		case 'L': if(freq<50) requestSetFrequency(freq+1); Serial.printf("[KEYPAD] Tang 1Hz -> %.1f Hz\n", freq); break;
		case 'X': if(freq>0) requestSetFrequency(freq-1); Serial.printf("[KEYPAD] Giam 1Hz -> %.1f Hz\n", freq); break;
		case 'R': if(freq > 0) { requestSetRun(true); Serial.println(F("[KEYPAD] Lenh CHAY.")); } break;
        case 'E': handleEmergencyStop(); break;
        case '0': requestSetFrequency(0); requestSetRun(false); Serial.println(F("[KEYPAD] Dat 0Hz & DUNG.")); break;
        case '2': mode=AUTO; Serial.println(F("[KEYPAD] Chuyen sang che do Tu dong.")); break;
        case '3': mode=INPUT_FREQ; inputFreq=""; Serial.println(F("[KEYPAD] Chuyen sang che do Nhap tan so.")); break;
        case 'F': mode=NONE; break;
	}
}

void applyAutoModeState() {
    // 1. Kiểm tra thời gian NTP
    if (!useNTP || !getLocalTime(&timeinfo)) { 
        requestSetFrequency(0);
        requestSetRun(false); 
        return; 
    }

    // 2. Kiểm tra lỗi cảm biến
    if (pressure < 0) {
        requestSetFrequency(0);
        requestSetRun(false);
        running = false;
        Serial.println("[AUTO] Lỗi cảm biến (Áp âm) - Dừng an toàn");
        return; 
    } // <--- BẠN THIẾU DẤU NÀY Ở ĐÂY

    // 3. Logic điều khiển tự động theo áp suất
    else if (pressure < 1.0) { 
        requestSetFrequency(40.0);
        requestSetRun(true);
    } 
    else if (pressure <= 1.5) { 
        requestSetFrequency(30.0);
        requestSetRun(true);
    } 
    else if (pressure < 2.0) { 
        requestSetFrequency(15.0);
        requestSetRun(true);
    } 
    else { 
        requestSetFrequency(0);
        requestSetRun(false);
        Serial.println("[AUTO] Đạt áp suất khóa - Tạm nghỉ");
    }
}

void handleAuto() {
    
    if (!useNTP || !getLocalTime(&timeinfo)) return;
    applyAutoModeState();
}

void setupWifi() {
    Serial.println(F("Khoi dong WiFiManager..."));
    wm.setAPCallback([](WiFiManager* myWiFiManager) {
        Serial.println("Da vao che do AP"); inConfigurationMode = true; 
    });
    wm.setConfigPortalTimeout(120);
    if (wm.autoConnect("ESP32_PUMP_AP", "123456789")) {
        inConfigurationMode = false;
        Serial.printf("Da ket noi WiFi: %s\n", WiFi.SSID().c_str());
        Serial.printf("IP: %s\n", WiFi.localIP().toString().c_str());
        trySyncNTP();
    } else {
        inConfigurationMode = false; Serial.println(F("Ket noi that bai hoac AP timeout."));
    }
    wifiAttemptDone = true;
}

void handleForceAP(char k) {
    if (inConfigurationMode) return;
    if (k == 'G') {
        if (G_press_start_time == 0) { 
            G_press_start_time = millis();
        } 
        else {
            unsigned long heldTime = millis() - G_press_start_time;
            if (heldTime > 500) { 
                u8g2.clearBuffer();
                u8g2.setFont(u8g2_font_6x10_tf);
                u8g2.setCursor(10, 30);
                u8g2.printf("Dang giu G: %d/5s", (int)(heldTime / 1000));
                u8g2.sendBuffer();
            }

            if (heldTime >= forceAPHoldTime) {
                Serial.println("[KEYPAD] GIU NUT G OK! Khoi dong AP.");
                inConfigurationMode = true; 
                G_press_start_time = 0; 
                wm.startConfigPortal("ESP32_PUMP_AP", "123456789"); 
            }
        }
    } else {
        if (G_press_start_time != 0) G_press_start_time = 0;
    }
}

void handleRoot() { server.send(200, "text/html", HTML_CONTENT); }

void handleData() {
    String json = "{";
    json += "\"run\":" + String(running ? "true" : "false") + ",";
    json += "\"af\":" + String(actualFreq, 1) + ",";
    json += "\"sf\":" + String(freq, 1) + ",";
    json += "\"p\":" + String(pressure, 2) + ",";
    json += "\"flow\":" + String(estimatedFlow, 2) + ","; 
    json += "\"v\":" + String(voltage, 2) + ",";
    json += "\"mode\":\"" + String(mode == AUTO ? "AUTO" : (mode == MANUAL ? "MANUAL" : "MENU")) + "\"";
    json += "}";
    server.send(200, "application/json", json);
}

void handleSetRun() { 
    if(server.hasArg("s")) { bool s = (server.arg("s") == "1");
    requestSetRun(s); // Dùng Request
    mode = MANUAL; } 
    server.send(200, "text/plain", "OK");
}

void handleSetFreq() { 
    if(server.hasArg("v")) { 
        float f = server.arg("v").toFloat();
        if(f>=0 && f<=50) { 
            requestSetFrequency(f); // Dùng Request
            if(f>0) requestSetRun(true); 
            mode = MANUAL; 
        } 
    } 
    server.send(200, "text/plain", "OK");
}

void handleSetMode() { 
    if(server.hasArg("v")) { 
        if(server.arg("v")=="AUTO") { mode=AUTO; } else { mode=MANUAL; }
    } 
    server.send(200, "text/plain", "OK");
}

void handleUpdateEnd() {
    if (!authenticated) return server.requestAuthentication();
    server.sendHeader("Connection", "close");
    if (Update.hasError()) server.send(502, "text/plain", Update.errorString());
    else { server.sendHeader("Refresh", "10"); server.sendHeader("Location", "/"); server.send(307); delay(500); ESP.restart(); }
}

void handleUpdate() {
    
    esp_task_wdt_reset(); 

    size_t fsize = UPDATE_SIZE_UNKNOWN;
    if (server.hasArg("size")) fsize = server.arg("size").toInt();
    HTTPUpload &upload = server.upload();
    
    if (upload.status == UPLOAD_FILE_START) {
        authenticated = server.authenticate(authUser, authPass);
        if (!authenticated) { otaDone = 0; return; }
        Serial.printf("Bat dau Update: %s\n", upload.filename.c_str());
        if (!Update.begin(fsize)) Update.printError(Serial);
        
    } else if (authenticated && upload.status == UPLOAD_FILE_WRITE) {
        // Ghi dữ liệu vào Flash
        if (Update.write(upload.buf, upload.currentSize) != upload.currentSize) Update.printError(Serial);
        else otaDone = 100 * Update.progress() / Update.size();
        
    } else if (authenticated && upload.status == UPLOAD_FILE_END) {
        if (Update.end(true)) Serial.printf("Update Thanh cong: %u bytes\n", upload.totalSize);
        else { Serial.printf("%s\n", Update.errorString()); otaDone = 0; }
    }
}

void everySecond() { if (otaDone > 1) Serial.printf("OTA Progress: %d%%\n", otaDone);
}

void setupWebServer() {
    server.collectHeaders(csrfHeaders, 2); 
    server.on("/", HTTP_GET, handleRoot);
	server.on("/data", HTTP_GET, handleData);
    server.on("/set/run", HTTP_GET, handleSetRun);
    server.on("/set/freq", HTTP_GET, handleSetFreq);
    server.on("/set/mode", HTTP_GET, handleSetMode);
    server.on("/update", HTTP_POST, []() { handleUpdateEnd(); }, []() { handleUpdate(); });
    server.on("/update", HTTP_GET, []() {
        if (!server.authenticate(authUser, authPass)) return server.requestAuthentication();
        const char* updateHtml = R"=====( <!DOCTYPE html><html><body>
        <form method='POST' action='/update' enctype='multipart/form-data'>
            <h3>Update Firmware (OTA)</h3><p>Upload .bin file (admin/5555)</p>
            <input type='file' name='firmware'><input type='submit' value='Upload'>
        </form></body></html> )=====";
        server.send(200, "text/html", updateHtml);
    });
    server.begin();
	Serial.println("[WEB] Web Server Started!");
}

// TASK LCD CẬP NHẬT GIAO DIỆN
void TaskLCD(void * parameter) {
    String strDate, strTime, strIP;
    float tmpPressure, tmpVoltage, tmpActFreq, tmpFlow;
    bool tmpRunning, tmpMqtt;
    int tmpMode;
    for(;;) {
        strDate = getDateString();
        strTime = getTimeString();
        strIP = (WiFi.status() == WL_CONNECTED) ? WiFi.localIP().toString() : "N/A";
        tmpMqtt = (WiFi.status() == WL_CONNECTED) ? mqttClient.connected() : false;
        tmpPressure = pressure;
        tmpVoltage = voltage;
        tmpActFreq = actualFreq;
        tmpFlow = estimatedFlow;
        tmpRunning = running;
        tmpMode = mode;
        u8g2.firstPage();
        do {
            u8g2.setFont(u8g2_font_5x7_tf);
            if (inConfigurationMode) {
                u8g2.setCursor(0,10);
                u8g2.print("WIFI CONFIG MODE");
                u8g2.setCursor(0,25); u8g2.print("AP: ESP32_PUMP_AP");
                u8g2.setCursor(0,35); u8g2.print("IP: 192.168.4.1");
            } 
            else {
                // Header: Ngày & Giờ
                u8g2.setCursor(0,8);
                u8g2.print(strDate);
                u8g2.setCursor(65,8); u8g2.print(strTime);
                u8g2.drawLine(0,10,128,10);

                if (tmpMode == INPUT_FREQ) {
                    u8g2.setCursor(0,25);
                    u8g2.print("NHAP TAN SO (0-50):");
                    u8g2.setFont(u8g2_font_6x10_tf);
                    u8g2.setCursor(40,40); u8g2.print(inputFreq); u8g2.print("_");
                }
                else { 
                    // Dòng 1: Chế độ và Trạng thái
                    u8g2.setFont(u8g2_font_5x7_tf);
                    u8g2.setCursor(0,20); u8g2.print("Mode:");
                    u8g2.setCursor(25,20); u8g2.print(tmpMode==AUTO?"AUTO":(tmpMode==MANUAL?"MANUAL":"MENU"));
                    u8g2.setCursor(70,20); u8g2.print("TT:");
                    u8g2.setCursor(95,20); u8g2.print(tmpRunning?"CHAY":"DUNG");
                    u8g2.drawLine(0,22,128,22);
                    // Dòng 2: Áp suất và Điện áp
                    u8g2.setCursor(0, 32);
                    u8g2.print("Pre:"); 
                    if (tmpPressure >= 0) u8g2.printf("%.2fBar", tmpPressure); else u8g2.print("N/A");

                    u8g2.setCursor(68, 32); u8g2.print("Volt:");
                    if (tmpVoltage >= 0) u8g2.printf("%.1fV", tmpVoltage);
                    else u8g2.print("N/A");
                    u8g2.drawLine(0, 34, 128, 34);

                    // Dòng 3: Flow và Freq
                    u8g2.setFont(u8g2_font_5x7_tf);
                    u8g2.setCursor(0, 44);
                    u8g2.print("Flow:"); 
                    u8g2.printf("%.2fm3", tmpFlow); 
                    
                    u8g2.setFont(u8g2_font_5x7_tf);
                    u8g2.setCursor(68, 44);
                    u8g2.print("Fre:");
                    u8g2.printf("%.0fHz", tmpActFreq);
                    
                    u8g2.drawLine(0, 46, 128, 46);
                    
                    // Dòng cuối: WiFi & IP
                    u8g2.setFont(u8g2_font_5x7_tf);
                    u8g2.setCursor(0,55);
                    u8g2.print(WiFi.status()==WL_CONNECTED ? "WiFi: ON" : "WiFi: OFF");
                    u8g2.setCursor(80,55); u8g2.print(tmpMqtt ? "MQTT:OK" : "MQTT:--");
                    u8g2.setCursor(0,62); u8g2.print("IP: "); u8g2.print(strIP);
                }
            }
        } while(u8g2.nextPage());
        vTaskDelay(pdMS_TO_TICKS(200));
    }
}

// TASK MODBUS 
void TaskModbusAndAuto(void * parameter) {
	unsigned long lastActualFreqRead = 0;
	const unsigned long actualFreqInterval = 1000;
	for (;;) {
       
        
        // Kiểm tra xem có lệnh SET FREQ 
        if (pendingFreq >= 0) {
            executeSetFrequency(pendingFreq);
            pendingFreq = -1.0; // Đánh dấu đã xử lý xong
            vTaskDelay(pdMS_TO_TICKS(50)); 
        }

        // Kiểm tra xem có lệnh RUN/STOP đang chờ không
        if (pendingRun != -1) {
            executeSetRun(pendingRun == 1);
            pendingRun = -1; 
            vTaskDelay(pdMS_TO_TICKS(50));
        }

        // SAU ĐÓ MỚI ĐẾN PHIÊN ĐỌC CẢM BIẾN 
		if (millis() - lastActualFreqRead >= actualFreqInterval) {
			lastActualFreqRead = millis();
			actualFreq = readActualFrequency();
			vTaskDelay(pdMS_TO_TICKS(20)); 
			readSensor();
       
		}

		printSerialData();
		
        if (mode == AUTO) {
			if (millis() - lastAutoCheck >= autoCheckInterval) {
				lastAutoCheck = millis();
				handleAuto();
			}
		}
		vTaskDelay(pdMS_TO_TICKS(100));
	}
}

void setup() {
	Serial.begin(9600);
    Serial.println(F("\n=== ESP32-S3 + MQTT + WEB SERVER (SLAVE MODE - NO CONFLICT) ==="));
    systemStartTime = millis();

	pinMode(VFD_DE_RE, OUTPUT); digitalWrite(VFD_DE_RE, LOW);
    pinMode(SENSOR_DE_RE, OUTPUT); digitalWrite(SENSOR_DE_RE, LOW);
    Wire.begin(CUSTOM_SDA_PIN, CUSTOM_SCL_PIN); 
	u8g2.setI2CAddress(LCD_ADDRESS); u8g2.begin(); u8g2.setBusClock(100000); u8g2.setContrast(255);
    xTaskCreatePinnedToCore(TaskLCD, "LCDTask", 8192, NULL, 1, &displayTaskHandle, APP_CPU_NUM);
    vTaskDelay(pdMS_TO_TICKS(100));

	Serial2.begin(9600, SERIAL_8N1, VFD_RX, VFD_TX);
	Serial1.begin(9600, SERIAL_8N1, SENSOR_RX, SENSOR_TX);
	nodeVFD.begin(VFD_ID, Serial2);
	nodeVFD.preTransmission(preTransmission); nodeVFD.postTransmission(postTransmission);
	nodeSensor.begin(SENSOR_ID, Serial1);
	nodeSensor.preTransmission(preTransmissionSensor); nodeSensor.postTransmission(postTransmissionSensor);

    // loadSchedules(); 
	setupWifi();
    setupWebServer();
    if (WiFi.status() == WL_CONNECTED) {
        MDNS.begin("esp32-pump");
        MDNS.addService("http", "tcp", 80);
        MDNS.addService("_arduino", "_tcp", 8266);
        MDNS.addServiceTxt("_arduino", "_tcp", "tcp_check", "yes");
        ArduinoOTA.setHostname("esp32-pump");
        ArduinoOTA.begin();
        tkSecond.attach(1, everySecond);
        
        mqttClient.setServer(MQTT_SERVER, MQTT_PORT);
        mqttClient.setCallback(mqttCallback);
    }
	xTaskCreatePinnedToCore(TaskModbusAndAuto, "ModbusAutoTask", 10000, NULL, 1, NULL, PRO_CPU_NUM);
    esp_task_wdt_config_t wdt_config = {
        .timeout_ms = WDT_TIMEOUT * 1000, 
        .idle_core_mask = (1 << 0) | (1 << 1), 
        .trigger_panic = true 
    };
    esp_task_wdt_init(&wdt_config); 
    esp_task_wdt_add(NULL);
    
    Serial.println(F("He thong san sang (SLAVE MODE) & WDT Active!"));
}

void loop() {
    esp_task_wdt_reset();
    static bool wasConnected = true;
    char k = keypad.getKey();
    if (k) {
        if (!inConfigurationMode) Serial.printf("Phím nhấn: [%c]\n", k);
    }
    handleForceAP(k);
    if (inConfigurationMode) {
        wm.process();
        if (WiFi.status() == WL_CONNECTED) {
            inConfigurationMode = false; trySyncNTP();
            setupWebServer(); 
            mqttClient.setServer(MQTT_SERVER, MQTT_PORT);
            mqttClient.setCallback(mqttCallback); 
            Serial.println("[WM] Cấu hình thành công và thoát AP.");
        }
    }
    
 
    if (WiFi.status() == WL_CONNECTED) {
        if (!wasConnected) {
            Serial.println("✅ Có mạng lại rồi! Đồng bộ giờ NTP...");
            trySyncNTP();     
            reconnectMqtt();  
            wasConnected = true;
        }
        server.handleClient();
        sendDataToGoogleSheet();
        if (!mqttClient.connected()) reconnectMqtt();
        mqttClient.loop();
        sendDataToMqtt();
    }

    else {
        wasConnected = false; 
        
        static unsigned long lastWifiRetry = 0;
        if (millis() - lastWifiRetry > 10000) {
            lastWifiRetry = millis();
            Serial.println("⚠️ Mất kết nối WiFi! Đang thử kết nối lại...");
            WiFi.reconnect();     
        }
    }

    if (isAuthenticated) { 
		if (mode == NONE) handleModeSelection(k);
		else if (mode == MANUAL) handleManual(k);
		else if (mode == AUTO) {
			if (k) {
				if (k=='1') mode=MANUAL;
				else if (k=='3') { mode=INPUT_FREQ; inputFreq=""; }
				else if (k=='E') handleEmergencyStop();
				else if (k=='F') mode=NONE;
			}
		}
		else if (mode == INPUT_FREQ) handleInputFrequency(k);
    }
    ArduinoOTA.handle();
    vTaskDelay(pdMS_TO_TICKS(10));
}