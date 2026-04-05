import { configureSync, getConsoleSink } from "@logtape/logtape";

if (__DEBUG__) {
  configureSync({
    sinks: {
      console: getConsoleSink(),
    },
    loggers: [
      {
        category: "dl-once",
        sinks: ["console"],
        lowestLevel: "trace",
      },
    ],
  });
}
