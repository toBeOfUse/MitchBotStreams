import { Socket } from "socket.io-client";
import fscreen from "fscreen";
import VimeoPlayer from "@vimeo/player";
import { Video, VideoState, StateChangeRequest, StateElements } from "../types";

function secondsToHMS(seconds: number) {
    if (seconds < 3600) {
        return new Date(seconds * 1000).toISOString().substr(14, 5);
    } else {
        return new Date(seconds * 1000).toISOString().substr(11, 8);
    }
}

let userIsSeeking = false;

let popupTimer: NodeJS.Timeout | undefined = undefined;
function displayMessage(message: string) {
    const popup = document.querySelector("#toast") as HTMLDivElement;
    popup.innerHTML = message;
    popup.style.opacity = "1";
    if (popupTimer !== undefined) {
        clearTimeout(popupTimer);
    }
    popupTimer = setTimeout(() => {
        popup.style.opacity = "0";
        popupTimer = undefined;
    }, 4000);
}

const DOMControls = {
    playPause: document.querySelector(
        "#play-pause-button"
    ) as HTMLButtonElement,
    playPauseImage: document.querySelector(
        "#play-pause-image"
    ) as HTMLImageElement,
    seek: document.querySelector("#seek") as HTMLInputElement,
    timeDisplay: document.querySelector("#time-display") as HTMLSpanElement,
    fullscreen: document.querySelector(
        "#fullscreen-button"
    ) as HTMLButtonElement,
    fullscreenImage: document.querySelector(
        "#fullscreen-image"
    ) as HTMLImageElement,
    videoContainer: document.querySelector(
        "#video-container"
    ) as HTMLDivElement,
    controlsContainer: document.querySelector(
        "#controls-overlay"
    ) as HTMLDivElement,
};

/**
 * Responsible for creating and removing the DOM element that will directly display
 * the video (i. e. a <video> tag or an iframe containing embedded video) and
 * applying the state held by an instance of Player to it. Subclassed to deal with
 * aforementioned different elements for different video sources.
 */
abstract class VideoController {
    requestState: () => void;
    /**
     * @param requestState () => void: The video controller might need to request an updated
     * current video state (ideally from the server) if it thinks it's out-of-date
     * due to buffering or similar. As a result of calling this function, state
     * information should be passed to setState.
     */
    constructor(requestState: () => void) {
        this.requestState = requestState;
    }
    abstract videoElement: HTMLElement;
    // abstract get currentTimeMs(): number;
    abstract get durationMs(): number;
    abstract setState(playlist: Video[], v: VideoState): void;
    abstract remove(): void;
}

class HTML5VideoController extends VideoController {
    videoElement: HTMLVideoElement;
    prevSrc: string = "";
    get currentTimeMs(): number {
        return this.videoElement?.currentTime * 1000 || 0;
    }
    get durationMs(): number {
        return this.videoElement?.duration * 1000 || 0;
    }
    constructor(requestState: () => void) {
        super(requestState);
        const video = document.createElement("video");
        video.src = "";
        video.id = "player";
        video.controls = false;
        const container = document.querySelector("#video-container");
        if (!container) {
            console.error("could not select video container");
        } else {
            container.prepend(video);
        }
        this.videoElement = video;
        this.videoElement.addEventListener("durationchange", () => {
            DOMControls.timeDisplay.innerHTML = secondsToHMS(video.duration);
        });
        this.videoElement.addEventListener("timeupdate", () => {
            DOMControls.seek.value = String(
                (video.currentTime / video.duration) * 100
            );
        });
        this.videoElement.addEventListener("playing", () => {
            // this event is "Fired when playback is ready to start after having been
            // paused or delayed due to lack of data" (MDN); after buffering, we need
            // to request state to try to catch up to the server
            this.requestState();
        });
    }

    setState(playlist: Video[], v: VideoState) {
        const currentSource = playlist[v.currentVideoIndex];
        if (currentSource.src != this.prevSrc) {
            console.log("changing <video> src");
            this.videoElement.src = currentSource.src;
            this.prevSrc = currentSource.src;
        }
        console.log("setting video current time to", v.currentTimeMs / 1000);
        if (
            Math.abs(this.videoElement.currentTime * 1000 - v.currentTimeMs) >
            1000
        ) {
            this.videoElement.currentTime = v.currentTimeMs / 1000;
            DOMControls.seek.value = String(
                (v.currentTimeMs / this.durationMs) * 100
            );
        }
        if (v.playing && this.videoElement.paused) {
            DOMControls.playPauseImage.src = "/images/pause.svg";
            try {
                this.videoElement.play();
            } catch (e) {
                console.error("could not play");
                console.error(e);
            }
        } else if (!v.playing) {
            DOMControls.playPauseImage.src = "/images/play.svg";
            this.videoElement.pause();
        }
    }

    remove() {
        this.videoElement.remove();
    }
}

const youtubeAPIReady = new Promise<void>((resolve, reject) => {
    (<any>window).onYouTubeIframeAPIReady = () => {
        console.log("youtube api ready");
        resolve();
    };
    // from https://developers.google.com/youtube/iframe_api_reference
    let tag = document.createElement("script");
    tag.src = "https://www.youtube.com/iframe_api";
    let firstScriptTag = document.getElementsByTagName("script")[0];
    firstScriptTag.parentNode?.insertBefore(tag, firstScriptTag);
});

class YoutubeVideoController extends VideoController {
    videoElement: HTMLDivElement;
    YTPlayer: YT.Player | null = null;
    YTPlayerReady: Promise<void> | null = null;
    prevSrc: string = "";
    timeUpdate: NodeJS.Timeout | undefined;

    constructor(requestState: () => void) {
        super(requestState);
        this.videoElement = document.createElement("div");
        this.videoElement.id = "youtube-embed-location";
        const container = document.querySelector("#video-container");
        if (!container) {
            console.error("could not select video container");
        } else {
            container.prepend(this.videoElement);
        }
    }

    get currentTimeMs(): number {
        if (!this.YTPlayer) {
            return 0;
        } else {
            return this.YTPlayer.getCurrentTime() * 1000;
        }
    }

    get durationMs(): number {
        if (!this.YTPlayer) {
            return 0;
        } else {
            return this.YTPlayer.getDuration() * 1000;
        }
    }

    async setState(playlist: Video[], v: VideoState) {
        await youtubeAPIReady;
        const currentSource = playlist[v.currentVideoIndex];
        if (currentSource.src != this.prevSrc) {
            this.prevSrc = currentSource.src;
            if (!this.YTPlayer) {
                console.log("creating new YT.Player");
                this.YTPlayerReady = new Promise((resolve) => {
                    this.YTPlayer = new YT.Player("youtube-embed-location", {
                        height: "100%",
                        width: "100%",
                        videoId: currentSource.src,
                        playerVars: {
                            playsinline: 1,
                            cc_load_policy: currentSource.captions ? 1 : 0,
                            controls: 0,
                            enablejsapi: 1,
                            modestbranding: 1,
                            rel: 0,
                            autoplay: 0,
                        },
                        events: {
                            onReady: () => {
                                resolve();
                            },
                            onStateChange: (event) => {
                                const ytstate = {
                                    "-1": "unstarted",
                                    0: "ended",
                                    1: "playing",
                                    2: "paused",
                                    3: "buffering",
                                    5: "video cued",
                                };
                                console.log(
                                    "YT player state change to " +
                                        ytstate[event.data]
                                );
                                console.log(event);
                                if (event.data == 1) {
                                    // try to prevent player falling behind when it
                                    // starts playing especially after buffering
                                    this.requestState();
                                }
                            },
                        },
                    });
                    this.timeUpdate = setInterval(async () => {
                        await this.YTPlayerReady;
                        if (this.YTPlayer) {
                            DOMControls.timeDisplay.innerHTML = secondsToHMS(
                                this.YTPlayer.getDuration()
                            );
                            if (!userIsSeeking) {
                                DOMControls.seek.value = String(
                                    (this.YTPlayer.getCurrentTime() /
                                        this.YTPlayer.getDuration()) *
                                        100
                                );
                            }
                        }
                    }, 500);
                });
            } else {
                console.log("changing source for YT.Player");
                await this.YTPlayerReady;
                this.YTPlayer?.cueVideoById(currentSource.src);
            }
        }
        await this.YTPlayerReady;
        if (Math.abs(this.currentTimeMs - v.currentTimeMs) > 1000) {
            this.YTPlayer?.seekTo(v.currentTimeMs / 1000, true);
        }
        if (
            v.playing &&
            this.YTPlayer?.getPlayerState() != YT.PlayerState.PLAYING
        ) {
            this.YTPlayer?.playVideo();
            DOMControls.playPauseImage.src = "/images/pause.svg";
        } else if (
            !v.playing &&
            this.YTPlayer?.getPlayerState() == YT.PlayerState.PLAYING
        ) {
            this.YTPlayer.pauseVideo();
            DOMControls.playPauseImage.src = "/images/play.svg";
        }
    }
    remove() {
        if (this.YTPlayer) {
            this.YTPlayer.destroy();
        }
        if (this.videoElement) {
            this.videoElement.remove();
        }
        if (this.timeUpdate) {
            clearInterval(this.timeUpdate);
        }
    }
}

class VimeoVideoController extends VideoController {
    videoElement: HTMLDivElement;
    vimeoPlayer: VimeoPlayer | null = null;
    prevSrc: string = "";
    cachedDurationMs: number = 0;

    constructor(requestState: () => void) {
        super(requestState);
        this.videoElement = document.createElement("div");
        this.videoElement.id = "vimeo-embed-location";
        const container = document.querySelector("#video-container");
        if (!container) {
            console.error("could not select video container");
        } else {
            container.prepend(this.videoElement);
        }
    }

    get durationMs(): number {
        return this.cachedDurationMs;
    }

    async setState(playlist: Video[], v: VideoState) {
        const currentSource = playlist[v.currentVideoIndex];
        if (currentSource.src != this.prevSrc) {
            this.prevSrc = currentSource.src;
            if (!this.vimeoPlayer) {
                this.vimeoPlayer = new VimeoPlayer("vimeo-embed-location", {
                    id: Number(currentSource.src),
                    controls: false,
                    responsive: true,
                });
                DOMControls.seek.value = "0";
                DOMControls.timeDisplay.innerHTML = secondsToHMS(0);
                this.vimeoPlayer.on("durationchange", async (e) => {
                    this.cachedDurationMs = e.duration * 1000;
                    DOMControls.timeDisplay.innerHTML = secondsToHMS(
                        e.duration
                    );
                });
                this.vimeoPlayer.on("timeupdate", (e) => {
                    DOMControls.seek.value = String(
                        (e.seconds / e.duration) * 100
                    );
                });
                this.vimeoPlayer.on("playing", () => this.requestState());
            } else {
                this.vimeoPlayer.loadVideo(Number(currentSource.src));
            }
        }
        if (this.vimeoPlayer) {
            const isPaused = await this.vimeoPlayer.getPaused();
            if (v.playing && isPaused) {
                await this.vimeoPlayer.play();
                DOMControls.playPauseImage.src = "/images/pause.svg";
            } else if (!v.playing && !isPaused) {
                await this.vimeoPlayer.pause();
                DOMControls.playPauseImage.src = "/images/play.svg";
            }
            const playerCurrentTime = await this.vimeoPlayer.getCurrentTime();
            if (Math.abs(playerCurrentTime * 1000 - v.currentTimeMs) > 1000) {
                this.vimeoPlayer.setCurrentTime(v.currentTimeMs / 1000);
            }
        }
    }

    remove() {
        if (this.vimeoPlayer) {
            this.vimeoPlayer.destroy();
        }
        if (this.videoElement) {
            this.videoElement.remove();
        }
    }
}

/**
 * Function that creates listeners for events that occur on the DOMControls elements
 * to send the appropriate messages back to the server to request changes in the
 * video state.
 * @param io Socket.io client used for communicating with the server
 * @param player instance of Player used to determine the current player state, so
 * that we can  request specific changes to it
 */
function initializePlayerInterface(io: Socket, player: Player) {
    io.on("message", (message: string) => displayMessage(message));
    DOMControls.playPause.addEventListener("click", () => {
        const changeRequest: StateChangeRequest = {
            whichElement: StateElements.playing,
            newValue: !player.state.playing,
        };
        io.emit("state_change_request", changeRequest);
    });
    // store whether the player was playing, pre-seek and restore in endSeek?
    const beginSeek = () => {
        userIsSeeking = true;
        const changeRequest: StateChangeRequest = {
            whichElement: StateElements.playing,
            newValue: false,
        };
        io.emit("state_change_request", changeRequest);
    };
    const performSeek = () => {
        if (userIsSeeking && player.controller) {
            const newTimeMs =
                (Number(DOMControls.seek.value) / 100) *
                player.controller?.durationMs;
            const changeRequest: StateChangeRequest = {
                whichElement: StateElements.time,
                newValue: newTimeMs,
            };
            io.emit("state_change_request", changeRequest);
        }
    };
    const endSeek = () => {
        userIsSeeking = false;
    };
    DOMControls.seek.addEventListener("mousedown", beginSeek);
    DOMControls.seek.addEventListener("touchstart", beginSeek);
    DOMControls.seek.addEventListener("input", performSeek);
    DOMControls.seek.addEventListener("mouseup", endSeek);
    DOMControls.seek.addEventListener("touchend", endSeek);
    let runningFadeoutTimer: NodeJS.Timeout | undefined = undefined;
    DOMControls.videoContainer.addEventListener("mousemove", () => {
        if (runningFadeoutTimer) {
            clearTimeout(runningFadeoutTimer);
        }
        DOMControls.controlsContainer.classList.remove("fadedOut");
        runningFadeoutTimer = setTimeout(() => {
            DOMControls.controlsContainer.classList.add("fadedOut");
        }, 3000);
    });
    let currentlyFullscreen = false;
    fscreen.addEventListener("fullscreenchange", () => {
        if (fscreen.fullscreenElement) {
            currentlyFullscreen = true;
            DOMControls.fullscreenImage.src = "/images/exitfullscreen.svg";
            DOMControls.videoContainer.classList.add("fullscreen");
        } else {
            currentlyFullscreen = false;
            DOMControls.fullscreenImage.src = "/images/enterfullscreen.svg";
            DOMControls.videoContainer.classList.remove("fullscreen");
        }
    });
    DOMControls.fullscreen.addEventListener("click", () => {
        if (!currentlyFullscreen) {
            fscreen.requestFullscreen(DOMControls.videoContainer);
        } else if (currentlyFullscreen) {
            fscreen.exitFullscreen();
        }
    });
}

/**
 * Responsible for the current state of the video being played. Is a singleton,
 * assuming we only want one video playing at a time, which is all our HTML is set up
 * for. Creates, updates, and destroys instances of VideoController at will to
 * represent itself in the DOM. Receives state updates from the server.
 */
class Player {
    private playlist: Video[] = []; // use getter/setter
    playlistShown: boolean = false;
    state: VideoState = {
        playing: false,
        currentVideoIndex: 0,
        currentTimeMs: 0,
    };
    controller: VideoController | null = null;
    requestState: () => void;
    constructor(io: Socket) {
        io.on("state_set", (new_state: VideoState) => {
            this.state = new_state;
            if (this.playlist.length > 0) {
                this.createController();
            }
            this.controller?.setState(this.playlist, this.state);
        });
        this.requestState = () => io.emit("state_update_request");
    }
    setPlaylist(newPlaylist: Video[]) {
        this.playlist = newPlaylist;
        if (this.playlist.length > 0) {
            this.createController();
        }
        this.controller?.setState(this.playlist, this.state);
    }
    getPlaylist(): Video[] {
        return this.playlist;
    }
    createController() {
        const currentProvider =
            this.playlist[this.state.currentVideoIndex].provider;
        if (
            !currentProvider &&
            !(this.controller instanceof HTML5VideoController)
        ) {
            if (this.controller) {
                this.controller.remove();
            }
            console.log("creating new HTML5VideoController");
            this.controller = new HTML5VideoController(this.requestState);
        } else if (
            currentProvider == "youtube" &&
            !(this.controller instanceof YoutubeVideoController)
        ) {
            if (this.controller) {
                this.controller.remove();
            }
            console.log("creating new YoutubeVideoController");
            this.controller = new YoutubeVideoController(this.requestState);
        } else if (
            currentProvider == "vimeo" &&
            !(this.controller instanceof VimeoVideoController)
        ) {
            if (this.controller) {
                this.controller.remove();
            }
            console.log("creating new VimeoVideoController");
            this.controller = new VimeoVideoController(this.requestState);
        }
    }
}

function initVideo(io: Socket): Player {
    const player = new Player(io);
    initializePlayerInterface(io, player);
    return player;
}

export default initVideo;
