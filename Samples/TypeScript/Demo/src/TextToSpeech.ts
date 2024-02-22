import { LAppPal } from "./lapppal";
import {getWaveBlob} from "webm-to-wav-converter"
import { LANGUAGE_TO_VOICE_MAPPING_LIST } from "./languagetovoicemapping"; 


export class AzureTTS {
    private _ttsapikey: string;
    private _ttsregion: string;

    private _inProgress: boolean;


    constructor(){
        this._ttsapikey = ""; 
        this._ttsregion = "centralindia";
        this._inProgress = false;
    }

    async GetSpeech(language:string, text: string){

        if (this._inProgress || text === "") return "";
        this._inProgress = true;
        if (this._ttsregion === undefined){
            LAppPal.printMessage("Unvalid ttsRegion pls check!...")
            return;
        } 

        const requestHeaders: HeadersInit = new Headers();
        requestHeaders.set('Content-Type', 'application/ssml+xml');
        requestHeaders.set('X-Microsoft-OutputFormat', 'riff-8khz-16bit-mono-pcm');
        requestHeaders.set('Ocp-Apim-Subscription-Key', this._ttsapikey);

        const voice = LANGUAGE_TO_VOICE_MAPPING_LIST.find(c => c.voice.startsWith(language) && c.IsMale === false).voice;

        const ssml = `
<speak version=\'1.0\' xml:lang=\'${language}\'>
  <voice xml:lang=\'${language}\' xml:gender=\'Female\' name=\'${voice}\'>
    ${text}
  </voice>
</speak>`;

        const response = await fetch(`https://${this._ttsregion}.tts.speech.microsoft.com/cognitiveservices/v1`, {
            method: 'POST',
            headers: requestHeaders,
            body: ssml
        });

        const blob = await response.blob();

        var url = window.URL.createObjectURL(blob)
        const audio: any = document.getElementById('voice');
        audio.src = url;
        this._inProgress = false;
        LAppPal.printMessage(`Load Text to Speech url: ${url} progress: ${this._inProgress}`);
        return url;
    }

}