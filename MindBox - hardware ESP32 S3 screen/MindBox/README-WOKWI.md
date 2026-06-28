# MindBox Wokwi Diagram

This directory contains a Wokwi `diagram.json` for the MindBox ESP32-S3 wiring.

Notes:
- The main MCU is modeled with `board-esp32-s3-devkitc-1`.
- The TFT uses Wokwi's `wokwi-ili9341` part and follows the SPI pin map from `src/config.h`.
- The rotary encoder, light sensor, button, and shared DHT line match the current external wiring.
- The ToF sensor is represented with Wokwi's closest supported part, `wokwi-vl53l0x`.
- On the real board, the FT6336 touch controller and the ES8311 audio path are onboard parts and are not modeled separately here.

Open `diagram.json` in Wokwi to view the circuit.
