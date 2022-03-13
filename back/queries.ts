import EventEmitter from "events";
import path from "path";
import fs from "fs";

import knex, { Knex } from "knex";
import fetch from "node-fetch";
import execa from "execa";
import getVideoID from "get-video-id";

import logger from "./logger";
import {
    ChatMessage,
    Video,
    UserSubmittedFolderName,
    User,
    Token,
    Avatar,
    Subtitles,
} from "../constants/types";
import { youtubeAPIKey } from "./secrets";
import { is } from "typescript-is";

const streamsDB = knex({
    client: "better-sqlite3",
    connection: {
        filename: "./back/db/streams.db",
    },
});

/**
 * Database table wrapper that automatically fills in the metadata for any urls or
 * files that you wish to add and also emits a "video_added" event when a new video
 * is successfully added.
 */
type VideoRecord = Omit<Video, "captions">;
class Playlist extends EventEmitter {
    connection: Knex<any, unknown[]>;
    static thumbnailPath = path.join(__dirname, "../assets/images/thumbnails/");

    constructor(dbConnection: Knex<any, unknown[]>) {
        super();
        this.connection = dbConnection;
    }

    async hydrate(query: Promise<VideoRecord[]>): Promise<Video[]> {
        const videos = await query;
        return await Promise.all(
            videos.map(
                (v) =>
                    new Promise<Video>(async (resolve) => {
                        resolve({
                            ...v,
                            captions: await this.connection
                                .select(["file", "format"])
                                .from<Subtitles & { video: number }>(
                                    "subtitles"
                                )
                                .where({ video: v.id }),
                        });
                    })
            )
        );
    }

    async getVideoByID(id: number): Promise<Video | undefined> {
        const query = this.connection
            .select("*")
            .from<VideoRecord>("playlist")
            .where({ id });
        return (await this.hydrate(query))[0];
    }

    async getVideos(): Promise<Video[]> {
        const query = this.connection
            .select("*")
            .from<VideoRecord>("playlist")
            .orderBy("folder", "id");
        return await this.hydrate(query);
    }

    async getNextVideo(v: Video | null): Promise<Video | undefined> {
        if (!v) {
            return undefined;
        }
        const query = this.connection
            .select("*")
            .from<VideoRecord>("playlist")
            .where({ folder: v.folder })
            .andWhere("id", ">", v.id)
            .orderBy("id")
            .limit(1);
        return (await this.hydrate(query))[0];
    }

    async getPrevVideo(v: Video | null): Promise<Video | undefined> {
        if (!v) {
            return undefined;
        }
        const query = this.connection
            .select("*")
            .from<VideoRecord>("playlist")
            .where({ folder: v.folder })
            .andWhere("id", "<", v.id)
            .orderBy("id", "desc")
            .limit(1);
        return (await this.hydrate(query))[0];
    }

    async addFromURL(url: string) {
        const providerInfo = getVideoID(url);
        if (!providerInfo.service || !providerInfo.id) {
            throw "url was not parseable by npm package get-video-id";
        }

        const rawVideo: Omit<
            VideoRecord,
            "id" | "duration" | "title" | "thumbnail"
        > = {
            provider: providerInfo.service,
            src: providerInfo.id,
            folder: UserSubmittedFolderName,
        };
        const {
            durationSeconds: duration,
            title,
            thumbnail,
        } = await Playlist.getVideoMetadata(rawVideo);
        await this.addRawVideo({
            ...rawVideo,
            duration,
            title: title || url,
            thumbnail,
            captions: [],
        });
    }

    async addFromFile(
        video: Pick<Video, "src" | "title" | "folder">,
        thumbnail: Buffer | undefined = undefined,
        captions: Subtitles[] = []
    ) {
        const metadata = await Playlist.getVideoMetadata({
            src: video.src,
            provider: undefined,
        });
        await this.addRawVideo({
            captions,
            ...video,
            duration: metadata.durationSeconds,
            thumbnail: thumbnail || metadata.thumbnail,
        });
    }

    async addRawVideo(
        v: Omit<VideoRecord, "id"> & {
            thumbnail: Buffer | undefined;
            captions: Subtitles[];
        }
    ) {
        const existingCount = Number(
            (await this.connection.table("playlist").count({ count: "*" }))[0]
                .count
        );
        const alreadyHaveVideo = (
            await this.connection
                .table("playlist")
                .count({ count: "*" })
                .where("src", v.src)
        )[0].count;
        if (existingCount < 100 || alreadyHaveVideo) {
            if (alreadyHaveVideo) {
                logger.debug("deleting and replacing video with src " + v.src);
                await this.connection
                    .table("playlist")
                    .where("src", v.src)
                    .del();
            } else {
                logger.debug(
                    "playlist has " + existingCount + " videos; adding one more"
                );
            }
            const { thumbnail, captions, ...videoRecord } = v;
            const ids = await this.connection
                .table<Video>("playlist")
                .insert(videoRecord);
            if (thumbnail) {
                Playlist.saveThumbnail(ids[0], thumbnail);
            }
            if (captions.length) {
                for (const caption of captions) {
                    await this.saveCaptions(ids[0], caption);
                }
            }
            this.emit("video_added");
        }
    }

    saveCaptions(videoID: number, caption: Subtitles) {
        return this.connection
            .table<Subtitles & { video: number }>("subtitles")
            .insert({ ...caption, video: videoID });
    }

    static saveThumbnail(videoID: number, thumbnail: Buffer): Promise<void> {
        return new Promise((resolve, reject) =>
            fs.writeFile(
                path.join(this.thumbnailPath, String(videoID) + ".jpg"),
                thumbnail,
                (err) => {
                    if (err) {
                        logger.error(JSON.stringify(err));
                        reject();
                    } else {
                        resolve();
                    }
                }
            )
        );
    }

    static async getVideoMetadata(
        video: Pick<Video, "src" | "provider">
    ): Promise<{
        durationSeconds: number;
        thumbnail: Buffer | undefined;
        title: string | undefined;
    }> {
        let injectedThumbnail: Buffer | undefined = undefined;
        const injectionSource = path.join(
            Playlist.thumbnailPath,
            "/injected/",
            video.src + ".jpg"
        );
        if (fs.existsSync(injectionSource)) {
            injectedThumbnail = fs.readFileSync(injectionSource);
        }
        if (!video.provider) {
            const location = path.join(__dirname, "../assets/", video.src);
            const subproccess = await execa("ffprobe", [
                "-v",
                "quiet",
                "-print_format",
                "json",
                "-show_format",
                location,
            ]);
            const info = JSON.parse(subproccess.stdout);
            return {
                durationSeconds: Number(info.format.duration),
                thumbnail: injectedThumbnail,
                title: undefined,
            };
        } else if (video.provider == "youtube") {
            const apiCall =
                `https://youtube.googleapis.com/youtube/v3/videos?` +
                `part=contentDetails&part=snippet&id=${video.src}&key=${youtubeAPIKey}`;
            const data = (await (await fetch(apiCall)).json()).items[0];
            const durationString = data.contentDetails.duration as string;
            const comps = Array.from(durationString.matchAll(/\d+/g)).reverse();
            let duration = 0;
            let acc = 1;
            for (const comp of comps) {
                duration += Number(comp) * acc;
                acc *= 60;
            }
            let thumbnail = injectedThumbnail;
            if (!thumbnail) {
                const thumbs = data.snippet.thumbnails;
                let thumbnailURL;
                if ("standard" in thumbs) {
                    thumbnailURL = thumbs.standard.url;
                } else if ("high" in thumbs) {
                    thumbnailURL = thumbs.high.url;
                } else {
                    thumbnailURL = thumbs[Object.keys(thumbs)[0]].url || "";
                }
                thumbnail = await (await fetch(thumbnailURL)).buffer();
            }
            return {
                durationSeconds: duration,
                title: data.snippet.title,
                thumbnail,
            };
        } else if (video.provider == "vimeo") {
            const apiCall = `http://vimeo.com/api/v2/video/${video.src}.json`;
            const data = await (await fetch(apiCall)).json();
            let thumbnail = injectedThumbnail;
            if (!thumbnail) {
                const thumbnailURL = data[0].thumbnail_large;
                thumbnail = await (await fetch(thumbnailURL)).buffer();
            }
            return {
                durationSeconds: data[0].duration,
                title: data[0].title,
                thumbnail,
            };
        } else if (video.provider == "dailymotion") {
            const apiCall = `https://api.dailymotion.com/video/${video.src}&fields=duration,title,thumbnail_480_url`;
            const data = await (await fetch(apiCall)).json();
            let thumbnail = injectedThumbnail;
            if (!thumbnail) {
                const thumbnailURL = data.thumbnail_480_url;
                thumbnail = await (await fetch(thumbnailURL)).buffer();
            }
            return {
                durationSeconds: data.duration,
                title: data.title,
                thumbnail,
            };
        } else {
            throw "unrecognized video provider";
        }
    }
}

async function addMessage(m: ChatMessage) {
    await streamsDB.table<ChatMessage>("messages").insert(m);
}

async function getRecentMessages(howMany: number = 20): Promise<ChatMessage[]> {
    return (
        await streamsDB
            .table<ChatMessage>("messages")
            .select([
                "isAnnouncement",
                "messageHTML",
                "userID",
                "senderName",
                "senderAvatarURL",
                "createdAt",
            ])
            .orderBy("createdAt", "desc")
            .limit(howMany)
    ).reverse();
}

async function saveUser(user: Omit<User, "id" | "createdAt">) {
    return (
        await streamsDB
            .table<User>("users")
            .insert(
                {
                    ...user,
                    createdAt: new Date(),
                },
                ["id", "createdAt"]
            )
            .onConflict(["id"])
            .merge()
    )[0];
}

/**
 * basically for npcs
 */
async function ensureUserIDs(ids: number[]) {
    await streamsDB
        .table<User>("users")
        .insert(
            ids.map((id) => ({ createdAt: new Date(), watchTime: 0, id })),
            ["id", "createdAt"]
        )
        .onConflict(["id"])
        .ignore();
}

async function getUser(token: string): Promise<User | undefined> {
    if (!is<string>(token)) {
        return undefined;
    }
    const userID = await streamsDB
        .table<Token>("tokens")
        .where("token", token)
        .select(["userID"]);
    if (!userID.length) {
        return undefined;
    } else {
        return (
            await streamsDB
                .table<User>("users")
                .where("id", userID[0].userID)
                .select("*")
        )[0];
    }
}

async function getAvatar(id: number): Promise<Avatar | undefined> {
    const avatar = await streamsDB
        .table<Avatar>("avatars")
        .where("id", id)
        .select("*");
    return avatar[0];
}

async function getAllAvatars(): Promise<Avatar[]> {
    return await streamsDB.table<Avatar>("avatars").select("*");
}

async function saveToken(token: Token) {
    await streamsDB.table<Token>("tokens").insert(token);
}

async function getUserSceneProp(
    user: Pick<User, "id">,
    scene: string
): Promise<string | undefined> {
    const result = await streamsDB
        .table<{ prop: string; userID: number; scene: string }>("usersToProps")
        .where({ userID: user.id, scene: scene })
        .select(["prop"]);
    return result[0]?.prop;
}

async function saveUserSceneProp(
    user: Pick<User, "id">,
    scene: string,
    prop: string
) {
    await streamsDB
        .table<{ prop: string; userID: number; scene: string }>("usersToProps")
        .insert({ prop, scene, userID: user.id })
        .onConflict(["userID", "scene"])
        .merge();
}

/**
 * Serves as the global singleton playlist object at the moment. Could be divided up
 * into multiple instances of the playlist class later.
 */
const playlist = new Playlist(streamsDB);

export {
    Playlist,
    playlist,
    getRecentMessages,
    addMessage,
    saveUser,
    getUser,
    saveToken,
    getAvatar,
    getAllAvatars,
    getUserSceneProp,
    saveUserSceneProp,
    ensureUserIDs,
};
