import http from "http";
import express from "express";
import compression from "compression";

import initTheater from "./theater";
import initUploads from "./upload";
import logger from "./logger";
import cdn from "./imagecdn";

import webpackConfig from "../webpack.config";
import webpack from "webpack";
import { existsSync } from "fs";
const mode =
    process.env.NODE_ENV == "production" ? "production" : "development";
logger.info("starting webpack in mode " + mode);
const webpacker = webpack(webpackConfig(null, { mode }));
const webpackCallback = (
    err: Error | undefined,
    stats: webpack.Stats | undefined
) => {
    if (err || stats?.hasErrors()) {
        logger.warn("webpack error");
        if (err) {
            console.error(err.stack || err);
        }
    }
    console.log(
        stats?.toString({
            colors: true,
            chunks: false,
        })
    );
};
if (mode == "development") {
    webpacker.watch({ aggregateTimeout: 300 }, webpackCallback);
} else {
    webpacker.run(webpackCallback);
}

const app = express();
app.use(compression());
app.use(function (req, res, next) {
    if (
        req.url == "/" ||
        req.url.endsWith("/index.html") ||
        mode == "development"
    ) {
        res.setHeader(
            "Cache-Control",
            "no-cache, no-store, max-age=0, must-revalidate"
        );
    }
    next();
});
app.use(express.static("dist"));
app.use((req, _res, next) => {
    if (req.url.startsWith("/images/thumbnails/")) {
        if (!existsSync("./assets" + req.url)) {
            req.url = "/images/video-file.svg";
        }
    }
    next();
});
app.use(express.static("assets"));
app.use(cdn());

const server = http.createServer(app);
initTheater(server, app);
initUploads(app);

server.listen(8080, () => logger.info("app running on 8080..."));
