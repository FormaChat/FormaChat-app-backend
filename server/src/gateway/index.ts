import { Express } from 'express';
import authGateway from './auth.gateway';
import businessGateway from './business.gateway';
import chatGateway from './chat.gateway';
import emailGateway from './email.gateway';

export function applyGateways(app: Express): void {
  app.use(authGateway);
  app.use(businessGateway);
  app.use(chatGateway);
  app.use(emailGateway);
}

export { authGateway, businessGateway, chatGateway, emailGateway };
