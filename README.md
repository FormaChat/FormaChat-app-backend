### FORMACHAT BACKEND ARCHITECTURE

This repository contains the current backend architecture of www.formachat.com
. The system is designed as a microservices based architecture and currently consists of four services: Authentication, Email, Business Profile, and Chat.

The Authentication service handles user verification and authorization using JWT. The Business Profile service is responsible for data ingestion and vector embedding, enabling business specific knowledge to be stored efficiently. The Chat service manages data retrieval and generates context aware responses to end user inquiries through the chatbot. The Email service consumes messages from RabbitMQ queues and delivers relevant notifications and information to end users.

Additional details about the technology stack will be documented in a future update.