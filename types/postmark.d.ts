declare module 'postmark' {
  export class ServerClient {
    constructor(token: string);
    sendEmailWithTemplate(options: any): Promise<any>;
  }
}

