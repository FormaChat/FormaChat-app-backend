# 🔐 Auth Service

The **Auth Service** is the gatekeeper of the ChatForge AI platform. It handles all user authentication, authorization, and session management, ensuring that only verified users can access the system.

## 📝 Overview

This service provides a secure and scalable way to manage users. It is built with security in mind, utilizing **JWT** for stateless authentication, **Bcrypt** for password hashing, and **Redis** for rate limiting to prevent abuse. It also integrates with **RabbitMQ** to broadcast user events (like "User Created") to other services.

## ✨ Key Features

*   **User Registration & Login**: Secure sign-up and sign-in processes.
*   **JWT Authentication**: Issues and validates JSON Web Tokens for secure API access.
*   **Rate Limiting**: Uses **Redis** to limit the number of requests a user can make, protecting against brute-force attacks.
*   **Event Publishing**: Publishes events (e.g., `UserCreated`) to **RabbitMQ** so other services (like the Email Service) can react (e.g., send a welcome email).
*   **Input Validation**: Uses **Zod** to ensure all incoming data is correct and safe.

## 🛠 Tech Stack

*   **Runtime**: Node.js & TypeScript
*   **Framework**: Express.js
*   **Database**: MongoDB (via Mongoose)
*   **Caching/Rate Limiting**: Redis
*   **Messaging**: RabbitMQ (`amqplib`)
*   **Validation**: Zod
*   **Security**: Helmet, Bcrypt, JWT
