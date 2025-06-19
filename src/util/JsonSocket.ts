import * as net from "node:net";

export default abstract class JsonSocket {
    jsonRequestedClose = false;
    jsonPacketBuffer: Uint8Array | null = null;
    constructor(public socket: net.Socket) {
        socket.on("end", this.onSocketEnd.bind(this));
        socket.on("data", this._onSocketData.bind(this));
    }

    abstract onSocketEnd(): void;
    abstract onJson(o: object): void;

    closeSocket(): void {
        this.jsonRequestedClose = true;
        this.socket.end();
    }

    _onSocketData(data: Buffer) {
        const addBuffers = (buf1: Uint8Array | null, buf2: Buffer): Buffer => {
            if (buf1 === null)
                return buf2;
            const result = Buffer.alloc(buf1.length + buf2.length);
            result.set(buf1);
            result.set(buf2, buf1.length);
            return result;
        };

        let prevLineIndex = 0;
        let newlineIndex = data.indexOf("\n");
        while (newlineIndex !== -1) {
            this.gotLine(addBuffers(this.jsonPacketBuffer, data.subarray(prevLineIndex, newlineIndex)));
            this.jsonPacketBuffer = null;
            prevLineIndex = newlineIndex + 1;
            newlineIndex = data.indexOf("\n", prevLineIndex);
        }
        this.jsonPacketBuffer = addBuffers(this.jsonPacketBuffer, data.subarray(prevLineIndex));
    }

    gotLine(data: Buffer): void {
        // this deals with logical buffering that is still happening
        if (this.jsonRequestedClose)
            return;

        let obj: object | undefined = undefined;
        try {
            const str = data.toString("utf-8");  // this can't fail
            obj = JSON.parse(str);
        } catch (SyntaxError) {
            console.log("JSON error in a received message. Requesting socket end.");
            this.closeSocket();
        }

        if (obj !== undefined) {
            this.onJson(obj);
        }
    }

    sendJson(o: object): boolean {
        if (this.jsonRequestedClose)
            return false;

        this.socket.write(JSON.stringify(o) + "\n");
        return true;
    }
}