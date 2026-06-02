import mongoose, {Schema, Document, Model, Types, Callback} from "mongoose";



// ========================================
// INTERFACES (TypeScript Types)
// ========================================

/**
 * ChatSession Interface
 * Stores metadata about each conversation
 * NEVER DELETED - Kept forever for analytics
*/

export interface IChatSession extends Document {
    _id: Types.ObjectId;
    sessionId: string;
    businessId: string;
    // Tracking returned users
    visitorId?: string;
    // Contact information of users
    contact: {
        captured: boolean;
        email?: string;
        phone?: string;
        name?: string;
        capturedAt?: Date;
        capturedInMessageId?: Types.ObjectId; // Which message captured it
    };
    // session metadata
    status: 'active' | 'ended' | 'abandoned';
    startedAt: Date;
    lastMessageAt: Date;
    endedAt?: Date;
    // Analytics
    messageCount: number;
    userMessageCount: number; // How many times user spoke
    botMessageCount: number;
    // Intent detection (future use - AI agent handoff)
    intent?: {
        type: 'enquiry' | 'booking' | 'purchase' | 'support';
        confidence?: number;
        detectedAt?: Date;
    };
    // Future AI agent handoff tracking
    agentHandoff?: {
        isHandedOff: boolean;
        agentType?: string; // booking , payment, etc
        handoFFAt?: Date;
        completedAt?: Date;
    };
    // Technical metadata
    userAgent?: string;
    ipAddress?: string;
    referrer?: string;

    //Flags
    hasUnreadMessages: boolean; // For business owner dashboard
    isStarred: boolean; // owner can flag important sessions
    tags: string[]; // Custom tags '[refund_request, VIP]'

    createdAt: Date;
    deletedAt?: Date;
    updatedAt: Date;
}

/**
 * ChatMessage Interface
 * Stores individual messages in conversations
 * AUTO-DELETED after 7 days (FREE tier)
*/

export interface IChatMessage extends Document {
    _id: Types.ObjectId;
    sessionId: string;              // Links to chatsessions
    businessId: string;             // Denormalized for fast queries

    // Message Content

    role: 'user' | 'assistant' | 'system';
    content: string;                // The actual message text

    // Contact extraction (if this message captured contact)

    extractedContact?: {
        email?: string;
        phone?: string;
        name?: string;
        confidence?: number;                // How sure the AI is (0-1)

    };

    // AI metadata (for cost tracking & debugging)
    llmModel?: string;
    tokens?:{
        prompt: number;
        completion: number;
        total: number;
    };
    latency?: number;       // Response time in ms

    // Vector context used (for debugging & analytics)
    vectorsUsed?: Array<{
        chunkId: string;
        relevanceSource: number;
        sourceType: 'questionnaire' | 'document' | 'image';
    }>;

    timestamp: Date;
    // Soft delete
    deletedAt?: Date; // Set by cron job after 7 days
    createdAt: Date;
    updatedAt: Date;

}

/**
 * ContactLead Interface
 * Deduplicated CRM database
 * NEVER DELETED - This is the business's most valuable data
*/

export interface IContactLead extends Document {
    _id: Types.ObjectId;
    businessId: string;
    // Contact information
    email?: string;
    phone?: string;
    name?: string;

    // Engagement history
    firstSessionId: string;
    lastSessionId: string;
    firstContactDate: Date;
    lastContactDate: Date;
    totalSessions: number;       // How many times they chatted
    totalMessages: number;         // Total messages accross all sessions

    // Lead management
    status: 'new' | 'contacted' | 'qualified' | 'converted' | 'spam';
    leadScore?: number;
    tags: string[];
    notes?: string;             // Business owner notes

    // Source tracking
    firstSource?: string;           // Where they cmae from
    capturedIntent?: string;        // What they wanted

    // Owner actions
    isStarred: boolean;
    assignedTo?: string;
    followUpDate?: Date;

    createdAt: Date;
    updatedAt: Date;
}


// ========================================
// SCHEMAS (MongoDB Structure)
// ========================================

/**
 * ChatSession Schema
*/

const ChatSessionSchema: Schema = new Schema({
    sessionId: {
        type: String,
        required: true,
        unique: true,
        index: true,
    },
    businessId: {
        type: String,
        required: true,
        index: true,
    },
    visitorId: {
        type: String,
        index: true,
    },
    contact: {
        captured: {
            type: Boolean,
            default: false,
            index: true,
        },
        email: {
            type: String,
            lowercase: true,
            trim: true,
        },
        phone: String,
        name: String,
        capturedAt: Date,
        capturedInMessageId: {
            type: Schema.Types.ObjectId,
            ref: 'ChatMessage',

        },
    },
    status: {
        type: String,
        enum: ['active', 'ended', 'abandoned'],
        default: 'active',
        index: true,
    },
    startedAt: {
        type: Date,
        default: Date.now,
        index: true,
    },
    lastMessageAt: {
        type: Date,
        default: Date.now,
    },
    endedAt: Date,
    messageCount: {
        type: Number,
        default: 0,
    },
    userMessageCount: {
        type: Number,
        default: 0,
    },
    botMessageCount: {
        type: Number,
        default: 0,
    },
    intent: {
        type: {
            type: String,
            enum: ['enquiry', 'booking', 'purchase', 'support'],
        },
        confidence: Number,
        detectedAt: Date,
    },
    agentHandOff: {
        isHandedOff: {
            type: Boolean,
            default: false,
        },
        agentType: String,
        handOffAt: Date,
        completedAt: Date,
    },
    userAgent: String,
    ipAddress: String,
    referrer: String,
    hasUnreadMessages: {
        type: Boolean,
        default: false,
    },
    isStarred: {
        type: Boolean,
        default: false,
    },
    tags: [{
        type: String,
    }],
    deletedAt: {
        type: Date,
        index: true,
    }
}, {
    timestamps: true,
});

// Indexes for fast queries

ChatSessionSchema.index({businessId: 1, startedAt: -1});
ChatSessionSchema.index({businessId: 1, 'contact.captured': 1});
ChatSessionSchema.index({businessId: 1, status: 1});
ChatSessionSchema.index({visitorId: 1, businessId: 1});

/**
 * ChatMessage Schema
*/

const ChatMessageSchema: Schema = new Schema({
    sessionId: {
        type: String,
        required: true,
        index: true,
    },
    businessId: {
        type: String,
        required: true,
        index: true,
    },
    role: {
        type: String,
        required:true,
        enum: ['user', 'assistant', 'system'], 
    },
    content: {
        type: String,
        required: true,
    },
    extractedContact: {
        email: String,
        phone: String,
        name: String,
        confidence: Number,
    },
    llmModel: String,
    tokens: {
        prompt: Number,
        completion: Number,
        total: Number,
    },
    latency: Number,
    vectorsUsed: [{
        chunkId: String,
        relevanceScore: Number,
        sourceType: {
            type: String,
            enum: ['questionnaire', 'document', 'image'],
        },
    }],
    timestamp: {
        type: Date,
        default: Date.now,
        index: true,
    },
    deletedAt: {
        type: Date,
        index: true,
    },
}, {
    timestamps: true,
});

ChatMessageSchema.index({sessionId: 1, timestamp: 1});
ChatMessageSchema.index({businessId: 1, timestamp: -1});
ChatMessageSchema.index({timestamp: 1, deleteAt: 1});

/**
 * ContactLead Schema 
*/

const ContactLeadSchema: Schema = new Schema({
   businessId: {
    type: String,
    required: true,
    index: true,
   },
   email: {
    type: String,
    lowercase: true,
    trim: true,
    sparse: true, // Allows null but enforces unique when present
   },
   phone: {
    type: String,
    sparse: true,
   },
   name: String,
   firstSessionId: {
    type: String,
    required: true,
   },
   firstContactDate: {
    type: Date,
    default: Date.now,
   },
   lastContactDate: {
    type: Date,
    default: Date.now,
   },
   totalSessions: {
    type: Number,
    default: 1,
   },
   totalMessages: {
    type: Number,
    default: 0,
   },
   status: {
    type: String,
    enum: ['new', 'contacted', 'qualified', 'converted', 'spam'],
    default: 'new',
    index: true,
   },
   leadScore: {
    type: Number,
    min: 0,
    max: 100,
   },
   tags: [{
    type: String,
   }],
   notes: {
    type: String,
    maxlength: 1000,
   },
   firstSource: String,
   capturedIntent: String,
   isStarred: {
    type: Boolean,
    default: false,
   },
   assignedTo: String,
   followUpDate: Date,
}, {
    timestamps: true,
});

ContactLeadSchema.index({businessId: 1, email: 1}, {unique: true, sparse: true});
ContactLeadSchema.index({businessId: 1, phone: 1}, {sparse: true});
ContactLeadSchema.index({businessId: 1, status: 1});
ContactLeadSchema.index({businessId: 1, createdAt: -1});


// Validation: At least email or phone must exist

ContactLeadSchema.pre('save', async function() {
    const doc = this as any;
    if (!doc.email && !doc.phone) {
        throw new Error('At least email or phone must be provided');
    }
});


// MODEL EXPORTS

export interface IChatSessionModel extends Model<IChatSession> {}
export interface IChatMessageModel extends Model<IChatMessage> {}
export interface IContactLeadModel extends Model<IContactLead> {}

export const ChatSession = mongoose.model<IChatSession, IChatSessionModel>('ChatSession', ChatSessionSchema);
export const ChatMessage = mongoose.model<IChatMessage, IChatMessageModel>('ChatMessage', ChatMessageSchema);
export const ContactLead = mongoose.model<IContactLead, IContactLeadModel>('ContactLead', ContactLeadSchema);

export default {
    ChatSession,
    ChatMessage,
    ContactLead,
};