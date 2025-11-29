# 📧 Email Service

The **Email Service** handles all external communications for the platform. It listens for system events and sends transactional emails to users, ensuring they stay informed even when they aren't logged in.

## 📝 Overview

This service runs in the background and consumes messages from **RabbitMQ**. When significant events occur (like a new user signing up or a password reset request), this service picks up the message, renders a beautiful HTML email using **Handlebars** templates, and delivers it via the **Resend** API.

## ✨ Key Features

*   **Event-Driven Architecture**: Listens for events (e.g., `UserCreated`, `PasswordReset`) via **RabbitMQ** to send emails asynchronously.
*   **Transactional Emails**: Handles critical notifications like Welcome emails, OTPs (One-Time Passwords), and billing alerts.
*   **Template Engine**: Uses **Handlebars** to create dynamic, professional-looking HTML email templates.
*   **Reliable Delivery**: Integrates with **Resend** for high deliverability rates.

## 🛠 Tech Stack

*   **Runtime**: Node.js & TypeScript
*   **Framework**: Express.js
*   **Messaging**: RabbitMQ (`amqplib`)
*   **Email Provider**: Resend
*   **Templating**: Handlebars
*   **Utilities**: Axios, Winston
