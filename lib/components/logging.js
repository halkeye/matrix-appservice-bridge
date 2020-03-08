let winston = null;
try {
    winston = require("winston");
}
catch (ex) {
    // Missing winston, which is fine.
    if (ex.message !== "Cannot find module 'winston'") {
        throw ex;
    }
}
let chalk, format, formatterFn, colorFn;
if (winston) {
    require('winston-daily-rotate-file');
    chalk = require("chalk");
    format = winston.format;
}

const CHALK_LEVELS = {
    "debug": "blue",
    "info": "green",
    "warn": "yellow",
    "error": "red",
}


class LogWrapper {
    constructor() {
        this.logger = null;
        this.messages = []; // {type: string, messageParts: [object]}
    }

    setLogger(logger) {
        this.logger = logger;
    }

    debug(...messageParts) { this._log(messageParts, 'debug') }

    info(...messageParts) { this._log(messageParts, 'info') }

    warn(...messageParts) { this._log(messageParts, 'warn') }

    error(...messageParts) { this._log(messageParts, 'error') }

    _drain() {
        if (!this.logger) { return; }
        while (this.messages.length > 0) {
            const msg = this.messages[0];
            this.logger[msg.type](...msg.messageParts);
            this.messages.splice(0, 1);
        }
    }

    _log(messageParts, type) {
        if (this.logger === null) {
            this.messages.push({type, messageParts});
            return;
        }
        /* When we first start logging, the transports
         * won't be configured so we push to a queue.
         * When the transport becomes ready, the queue
         * is emptied. */
        this._drain();
        this.logger[type](...messageParts);
    }
}

class Logging {
    constructor() {
        this.loggers = new Map();
        this.transports = null;

        formatterFn = format.printf((info) => {
            return `${info.timestamp} ${info.level} ${info.label} ${info.message}`;
        });

        colorFn = format((info, opts) => {
            let level = info.level.toUpperCase();
            const levelColour = CHALK_LEVELS[info.level];
            if (levelColour) {
                info.level = chalk[levelColour](level);
            }
            return info;
        })
    }

    /*
        console: "error|warn|info|debug|off"
        fileDatePattern: "YYYY-MM-DD",
        timestampFormat: "MMM-D HH:mm:ss.SSS"
        files: {
            "abc.log" => "error|warn|info|debug|off"
        }
        maxFiles: 5
    */
    configure(config={}) {
        if (!config.fileDatePattern) {
            config.fileDatePattern = "YYYY-MM-DD";
        }
        if (!config.timestampFormat) {
            config.timestampFormat = "MMM-D HH:mm:ss.SSS";
        }
        if (!config.console) {
            config.console = "info";
        }
        if (!config.maxFiles) {
            config.maxFiles = 0;
        }
        this.config = config;

        if (this.transports) {
            for (const transport of this.transports) {
                if (transport.close) {
                    transport.close();
                }
            }
        }

        this.transports = [];
        if (config.console !== undefined && config.console !== "off") {
            this.transports.push(new (winston.transports.Console)({
                json: false,
                name: "console",
                level: config.console,
                format: format.combine(
                    format.splat(),
                    colorFn(),
                    formatterFn
                )
            }));
        }

        if (config.files !== undefined) {
            let i = 0;
            for (let filename of Object.keys(config.files)) {
                const level = config.files[filename];
                i++;
                this.transports.push(new (winston.transports.DailyRotateFile)({
                    filename,
                    datePattern: config.fileDatePattern,
                    name: `logfile` + i,
                    level,
                    maxFiles: config.maxFiles > 0 ? config.maxFiles : undefined
                }));
            }
        }

        this.loggers.forEach((wrapper, name) => {
            wrapper.setLogger(this.createLogger(name));
            wrapper._drain();
        });
    }

    get(name) {
        if (!this.loggers.has(name)) {
            const wrapper = new LogWrapper()
            this.loggers.set(name, wrapper);
            /* We won't assign create and assign a logger until
             * the transports are ready */
            if (this.transports !== null) {
                wrapper.setLogger(this.createLogger(name));
            }
        }
        return this.loggers.get(name);
    }

    createLogger(name) {
        const logger = winston.createLogger({
            transports: this.transports,
            format: format.combine(
                format.splat(),
                format.timestamp({
                    format: this.config.timestampFormat,
                }),
                format.label({label: name}),
                formatterFn
            ),
        });
        return logger;
    }
}

let instance;
let configured = false;
if (winston) {
    instance = new Logging();
}
else {
    // We don't have winston, so just log to the console.
    instance = {
        get: (name) => {
            const logWrapper = new LogWrapper();
            // Console has all the functions already.
            logWrapper.setLogger(console);
            return logWrapper;
        },
        configure: () => {
            // No-op this.
        },
    };
}

module.exports = {
    get: (name) => {
        return instance.get(name);
    },
    configure: (config) => {
        instance.configure(config);
        configured = true;
    },
    configured: () => {
        return configured;
    }
}
