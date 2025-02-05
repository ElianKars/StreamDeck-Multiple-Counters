import streamDeck, { LogLevel } from "@elgato/streamdeck";
import { IncrementCounter, ResetCounters } from "./actions/multiple-counters";
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// Function to get log level from config.json
function getLogLevel(): keyof typeof LogLevel {
    try {
        const __filename = fileURLToPath(import.meta.url);
        const __dirname = path.dirname(__filename);
        const configPath = path.join(__dirname, '../../com.github.eliankars.multiple-counters.sdPlugin/config.json');
        const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
        const logLevel = config.logLevel;

        if (logLevel === 'info' || logLevel === 'trace') {
            return logLevel.toUpperCase() as keyof typeof LogLevel;
        }
    } catch (error) {
        streamDeck.logger.info(`Error reading config.json: ${error}`); // Log the error
    }
    return 'INFO';
}

// Set log level based on config.json
const logLevel = getLogLevel();
streamDeck.logger.setLevel(LogLevel[logLevel] || LogLevel.INFO);
streamDeck.logger.trace(`Log level is: ${logLevel}`);

// Register actions
streamDeck.actions.registerAction(new IncrementCounter());
streamDeck.actions.registerAction(new ResetCounters());

// Connect to the Stream Deck
streamDeck.connect();