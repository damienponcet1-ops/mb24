#include <BLEDevice.h>
#include <BLEServer.h>
#include <BLEUtils.h>
#include <BLE2902.h>
#include <FastLED.h>

#define NUM_LEDS 198
#define DATA_PIN 2

CRGB leds[NUM_LEDS];

// Nordic UART Service
#define SERVICE_UUID           "6e400001-b5a3-f393-e0a9-e50e24dcca9e"
#define CHARACTERISTIC_UUID_RX "6e400002-b5a3-f393-e0a9-e50e24dcca9e"

// MoonBoard 2024 : 11 colonnes x 18 lignes.
// Le ruban commence en K18 et termine en A1.
//
// K : K18 -> K1
// J : J1  -> J18
// I : I18 -> I1
// H : H1  -> H18
// ... jusqu'à A : A18 -> A1.

int getLedIndex(String hold) {
    if (hold.length() < 2) return -1;

    char colChar = hold.charAt(0);
    int rowNum = hold.substring(1).toInt();

    int col = colChar - 'A';  // A=0 ... K=10
    int row = rowNum - 1;     // 1=0 ... 18=17

    if (col < 0 || col > 10 || row < 0 || row > 17) return -1;

    // Ordre physique : K, J, I, H, G, F, E, D, C, B, A
    int columnIndex = 10 - col;

    if (col % 2 == 0) {
        // A, C, E, G, I, K : haut -> bas (18 -> 1)
        return (columnIndex * 18) + (17 - row);
    } else {
        // B, D, F, H, J : bas -> haut (1 -> 18)
        return (columnIndex * 18) + row;
    }
}

class MyServerCallbacks : public BLEServerCallbacks {
    void onConnect(BLEServer* pServer) override {
        Serial.println("Bluetooth connecté !");
    }

    void onDisconnect(BLEServer* pServer) override {
        Serial.println("Bluetooth déconnecté ! Relance de la visibilité...");
        delay(500);
        pServer->getAdvertising()->start();
        Serial.println("Prêt pour une nouvelle connexion !");
    }
};

class MyCallbacks : public BLECharacteristicCallbacks {
    void onWrite(BLECharacteristic *pCharacteristic) override {
        String rxValue = pCharacteristic->getValue().c_str();

        if (rxValue.length() == 0) return;

        Serial.print("Reçu : ");
        Serial.println(rxValue);

        FastLED.clear();

        if (rxValue != "CLEAR") {
            int startIndex = 0;

            while (startIndex < rxValue.length()) {
                int commaIndex = rxValue.indexOf(',', startIndex);
                if (commaIndex == -1) commaIndex = rxValue.length();

                String moveData = rxValue.substring(startIndex, commaIndex);
                int colonIndex = moveData.indexOf(':');

                if (colonIndex != -1) {
                    String hold = moveData.substring(0, colonIndex);
                    String type = moveData.substring(colonIndex + 1);

                    int ledIndex = getLedIndex(hold);

                    if (ledIndex != -1) {
                        if (type == "S") {
                            leds[ledIndex] = CRGB::Green;
                        } else if (type == "P") {
                            leds[ledIndex] = CRGB::Blue;
                        } else if (type == "E") {
                            leds[ledIndex] = CRGB::Red;
                        }
                    }
                }

                startIndex = commaIndex + 1;
            }
        }

        FastLED.show();
    }
};

void setup() {
    Serial.begin(115200);

    FastLED.addLeds<WS2811, DATA_PIN, RGB>(leds, NUM_LEDS);
    FastLED.setBrightness(100);
    FastLED.clear();
    FastLED.show();

    BLEDevice::setMTU(512);
    BLEDevice::init("MoonBoard 2024");

    BLEServer *pServer = BLEDevice::createServer();
    pServer->setCallbacks(new MyServerCallbacks());

    BLEService *pService = pServer->createService(SERVICE_UUID);

    BLECharacteristic *pRxCharacteristic = pService->createCharacteristic(
        CHARACTERISTIC_UUID_RX,
        BLECharacteristic::PROPERTY_WRITE |
        BLECharacteristic::PROPERTY_WRITE_NR
    );

    pRxCharacteristic->setCallbacks(new MyCallbacks());

    pService->start();

    BLEAdvertising *pAdvertising = BLEDevice::getAdvertising();
    pAdvertising->addServiceUUID(SERVICE_UUID);
    pServer->getAdvertising()->start();

    Serial.println("MoonBoard 2024 prête !");
    Serial.println("198 LEDs - attente Bluetooth...");
}

void loop() {
    delay(10);
}
