import { Api } from "./api";
import { config } from "dotenv";
import { IListImage } from "./api/verses/interfaces.js";
import PQueue from "p-queue";
import { fileURLToPath } from "url";
import { dirname } from "path";
import Editly, { Layer } from "editly";
import { get_font } from "../utils";
import { Logger } from "../utils/logger";
import { downloadFile } from "../utils/download_stream";
import { upload } from "youtube-videos-uploader";
import { executablePath } from "puppeteer";
import { Video } from "youtube-videos-uploader/dist/types";
import { surahs } from "../constants/surah";
import fs from "fs/promises";

config();
const onVideoUploadSuccess = (videoUrl) => {
  console.log(videoUrl);
};

interface BuildRes {
  name: string;
  description: string;
  surah: number;
  offset: number;
}

class CalculatorManager {
  api = new Api();
  constructor(
    public page: number,
    public current: number,
    public verses: IListImage["verses"],
    public surah: number,
    public offset: number,
    public logger: Logger,
    public skipVerses: number[]
  ) {}
  getAudio() {
    return this.verses.map((verse) => [verse.audio.url, verse.audio.duration]);
  }
  async getVerses() {
    const words = this.verses.map(async (verse, i) => {
      return await this.api.verses.get.list({
        offset: this.offset,
        limit: this.page,
        surah: this.surah,
        type: "words",
      });
    });
    const res = await Promise.all(words);
    return res;
  }
  async getWords() {
    let verses = await this.getVerses();
    const words = verses[0].verses.map((verse) => {
      return {
        id: verse.id,
        words: verse.words.map((word, i) => {
          return {
            i,
            text: word.text_indopak,
            code: word.code,
            p: word.class_name,
          };
        }),
      };
    });
    return words;
  }
  async download() {
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = dirname(__filename);

    let path_split = __dirname.split("\\");
    path_split.splice(path_split.length - 1, path_split.length);
    let paths = [];
    this.verses = this.verses
      .filter((v) => !this.skipVerses.includes(v.id))
      .sort((a, b) => a.id - b.id);
    let promises = this.verses.map(async (verse, i) => {
      let mp3 = `${verse.audio.url.split("mp3")[1].replace("/", "")}mp3`;
      let pathmp3 = path_split.join("\\") + `\\tmp\\audio\\${mp3}`;
      const verses_words = await this.getWords();
      const ver = verses_words[i];
      paths.push({
        i: ver.id,
        font: parseInt(ver.words[0].p.replace("p", "")),
        name: pathmp3,
        words: ver.words,
        duration: verse.audio.duration,
      });

      await downloadFile(`http://verses.quran.com/${verse.audio.url}`, pathmp3);
    });
    await Promise.all(promises);
    return paths.sort((a, b) => a.i - b.i) as {
      i: number;
      name: string;
      duration: number;
      font: number;
      words: {
        i: number;
        text: string;
        code: string;
        p: string;
      }[];
    }[];
  }
}

export class Client {
  api = new Api();
  logger: Logger;
  constructor(debug: boolean = false) {
    this.logger = new Logger(debug);
  }
  async calculate({ surah, offset }: { surah: number; offset: number }) {
    if (surah > 114) {
      throw Error("Last surah is 114, you can't get beyond that.");
    }
    let current = 0; // video length
    let page = 1; // verse number
    let skipVerses = [];
    let verses = []; // verses
    while (true) {
      const list = await this.api.verses.get.list({
        recitation: 7,
        offset,
        limit: 1,
        page: page,
        type: "image",
        surah: surah,
      });
      // console.log(list.pagination.total_count, offset + page);
      if (list.pagination.total_count < offset + page) {
        // console.log("SKIP?");
        break;
      }
      let duration = list.verses[0].audio.duration ?? 0;
      if (duration + current > 60) {
        if (verses.length > 0) {
          break;
        }
        skipVerses.push(list.verses[0].id);
        // page++;
        offset = offset + 1;
        continue;
      }
      verses.push(list.verses[0]);
      page++;
      current += duration;
    }
    if (verses.length === 0) return false;
    return new CalculatorManager(
      page,
      current,
      verses,
      surah,
      offset,
      this.logger,
      skipVerses
    );
  }
  async build(offset: number, surah: number, i: number): Promise<BuildRes> {
    const downloader = await this.calculate({ surah: surah, offset });
    if (downloader == false) {
      return await this.build(0, surah + 1, i);
    }
    const files = await downloader.download();
    let total_duration = files
      .map((file) => file.duration)
      .reduce((prev, curr) => prev + curr);
    let start = 0;
    const layers = files
      .sort((a, b) => a.i - b.i)
      .map((file) => {
        return async () => {
          const text = {
            originX: 'center',
            originY: 'center',
            "type": "title",
            fontPath: await get_font(file.font),
            text: file.words
              .map((word) => {
                let htmlEntity = word.code;
                let codePoint = htmlEntity.match(/x([\da-fA-F]+)/)![1];
                let hexCode = codePoint.toUpperCase();
                let character = String.fromCharCode(parseInt(hexCode, 16));
                return character;
              })
              .join(" "),
            start,
            stop: start + file.duration,
          } as Layer;
          const voice = {
            type: "detached-audio",
            start,
            stop: start + file.duration,
            path: file.name,
          } as Layer;
          start += file.duration;
          return [voice, text] as Layer[];
        };
      })
      .flatMap((v) => v);
    const lays = (await new PQueue({ concurrency: 1 }).addAll(layers)).flatMap(
      (v) => v
    );
    const assets = await fs.readdir("assets");
    const randomFile = assets[Math.floor(Math.random() * assets.length)];
    await Editly({
      "enableFfmpegLog": false,
      keepSourceAudio: false,
      outPath: `output.mp4`,
      height: 1920,
      width: 1080,
      defaults: {
        transition: null,
      },
      clips: [
        {
          duration: total_duration,
          layers: [
            {
              type: "image-overlay",
              path: "assets/" + randomFile,
            },
            ...lays,
          ],
        },
      ],
    });

    return {
      name: `${surahs[surah - 1].name}`,
      description: `${surahs[surah - 1].name}`,
      surah,
      offset: downloader.offset + files.length,
    };
  }
  async upload(video: BuildRes): Promise<{ surah: number; offset: number }> {
    const credentials = {
      email: process.env.email,
      pass: process.env.password,
      recoveryemail: process.env.recoveryEmail || undefined,
    };

    const video1 = {
      path: `output.mp4`,
      title: video.name,
      description: "description 1",
      isNotForKid: true,
      onSuccess: onVideoUploadSuccess,
      skipProcessingWait: true,
    } as Video;

    await upload(credentials, [video1], {
      executablePath: executablePath(),
    }).then(console.log);
    return {
      surah: video.surah,
      offset: video.offset,
    };
  }
}
