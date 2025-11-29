# 🏢 Business Profile Service

The **Business Profile Service** is the "brain" of the platform. It manages all business-related data and handles the critical **RAG (Retrieval-Augmented Generation)** ingestion pipeline, turning raw documents and text into knowledge for the AI.

## 📝 Overview

This service allows users to create and manage their business profiles. Its most important job is to take business information—from questionnaires, uploaded PDFs, or even images—and convert it into a format the AI can understand. It uses **embedding models** to turn text into vectors and stores them in **Pinecone**.

## ✨ Key Features

*   **Business Profile Management**: Store and update business details, products, and policies.
*   **RAG Ingestion Pipeline**:
    *   **Text Processing**: Converts business descriptions into embeddings.
    *   **Document Parsing**: Reads PDFs and DOCX files (using `pdf-parse` and `mammoth`).
    *   **OCR (Optical Character Recognition)**: Extracts text from images using `tesseract.js`.
*   **Vector Storage**: Stores generated embeddings in **Pinecone**, organized by `businessId`.
*   **Tiered Access Control**: Handles feature limits (e.g., enabling image processing only for "Pro+" users).
*   **Smart Sync**: Efficiently updates or "soft freezes" vector data based on subscription status.

## 🛠 Tech Stack

*   **Runtime**: Node.js & TypeScript
*   **Framework**: Express.js
*   **Database**: MongoDB (via Mongoose)
*   **Vector DB**: Pinecone
*   **File Processing**: PDF-parse, Mammoth, Tesseract.js, File-type
*   **Messaging**: RabbitMQ (likely for async processing)
