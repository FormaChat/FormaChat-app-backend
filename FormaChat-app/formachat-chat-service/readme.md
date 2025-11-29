# 💬 Chat Service

The **Chat Service** is the "voice" of the platform. It powers the actual AI conversations, acting as the bridge between end-users and the intelligent Large Language Models (LLMs).

## 📝 Overview

This service handles the real-time interaction with the chatbot. When a user sends a message, this service performs **RAG (Retrieval-Augmented Generation)**: it finds the most relevant business information from **Pinecone** and feeds it into the **Groq** AI engine (Llama 3.1) to generate an accurate, context-aware response.

## ✨ Key Features

*   **Intelligent Response Generation**: Uses **Groq** (Llama 3.1) for lightning-fast, high-quality AI responses.
*   **Context Retrieval (RAG)**: Queries **Pinecone** to find specific business details (policies, prices, products) relevant to the user's question.
*   **Context-Aware**: Ensures the AI only answers based on the provided business data, minimizing hallucinations.
*   **Session Management**: Handles chat sessions and message flow.
*   **High Performance**: Designed for low latency to provide a snappy user experience.

## 🛠 Tech Stack

*   **Runtime**: Node.js & TypeScript
*   **Framework**: Express.js
*   **AI Inference**: Groq SDK (Llama 3.1)
*   **Vector Search**: Pinecone SDK
*   **Security**: Helmet, CORS
*   **Logging**: Winston
