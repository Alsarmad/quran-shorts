import { Api } from "./api";
import { IListImage } from "./api/verses/interfaces.js";
import axios from "axios";
import fs, { realpathSync } from "fs";
import https from "https";
import { fileURLToPath } from "url";
import { dirname } from "path";
class CalculatorManager {
  api = new Api();
  constructor(
    public page: number,
    public current: number,
    public verses: IListImage["verses"],
    public surah: number,
    public offset: number
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
    return await Promise.all(words);
  }
  async getWords() {
    const verses = await this.getVerses();
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
    let promises = this.verses.map(async (verse, i) => {
      let mp3 = `${verse.audio.url.split("mp3")[1].replace("/", "")}mp3`;
      let pathmp3 = path_split.join("\\") + `\\tmp\\audio\\${mp3}`;
      const verses_words = await this.getWords();
      // console.log(verse.verse_number, verses_words[i].id);
      const ver = verses_words[i];
      paths.push({
        i: ver.id,
        font: parseInt(ver.words[0].p.replace("p", "")),
        name: pathmp3,
        words: ver.words,
        duration: verse.audio.duration,
      });

      let instance = axios.create({
        httpsAgent: new https.Agent({
          rejectUnauthorized: false,
          keepAlive: true,
        }),
      });
      const res = await instance({
        method: "get",
        url: `http://verses.quran.com/${verse.audio.url}`,
        responseType: "stream",
      });
      res.data.pipe(fs.createWriteStream(pathmp3));
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
  constructor() {}
  async calculate({ surah, offset }: { surah: number; offset: number }) {
    let current = 0; // video length
    let page = 1; // verse number
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
      if (list.pagination.next_page == null) {
        break;
      }
      let duration = list.verses[0].audio.duration ?? 0;
      if (duration + current > 60) {
        break;
      }
      verses.push(list.verses[0]);
      page++;
      current += duration;
    }
    return new CalculatorManager(page, current, verses, surah, offset);
  }
  build() {
    // build the video and download it into the pc files
  }
  upload() {
    // uploading short into youtube
  }
}
