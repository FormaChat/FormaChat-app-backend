import mongoose, { Schema, Document, Model, Types } from "mongoose";

export interface IBusinessDocument extends Document {
  _id: Types.ObjectId;
  userId: string;
  userEmail: string;
  isActive: boolean;
  freezeInfo?: {
    isFrozen: boolean;
    reason?: 'trial_expired'| 'payment_failed'| 'admin_action' | 'subscription_canceled'| 'user_requested';
    frozenAt?: Date;
    frozenBy?: 'system' | 'admin';
    adminNote?: string;
    autoUnfreezeAt?: Date;
  };
  basicInfo: {
    businessName: string,
    businessDescription: string,
    businessType: string,
    operatingHours: string,
    location: string,
    timezone?: string,
  };
  productsServices: {
    offerings: string;
    popularItems: Array<{
      name: string;
      description?: string;
      price?: number;
    }>;
    serviceDelivery: string[];
    pricingDisplay?: {
      canDiscussPricing: boolean;
      pricingNote?: string;
    };
  };
  customerSupport: {
    faqs: Array<{
      question: string;
      answer: string;
    }>;
    policies: {
      refundPolicy: string;
      cancellationPolicy?: string;
      importantPolicies?: string;
    };
    chatbotTone: string;
    chatbotGreeting?: string;
    chatbotRestrictions?: string;
  };
  contactEscalation: {
    contactMethods: Array<{
      method: string;
      value: string;
    }>;
    escalationContact: {
      name: string;
      email: string;
      phone?: string;
    };
    chatbotCapabilities: string[];
  };
  // for PRO+ Tiers 
  files?: {
    documents: Array<{
      fileName: string;
      fileUrl: string;
      uploadDate: Date;
      fileSize: number;
    }>;
    images: Array<{
      fileName: string;
      fileUrl: string;
      uploadDate: Date;
      category?: string;
    }>;
  };
  // Vector DB info
  vectorInfo:{
    namespace: string; // `business_id`
    lastVectorUpdate: Date;
    vectorStatus: 'pending' | 'completed' | 'failed' | 'frozen';
    needsUpdate?: boolean;
    vectorCount?: number;
    lastSyncAttempt?: Date;
    processingErrors?: {     
    lastError?: string;
    lastErrorAt?: Date;
  };
  };
  canChat(): {allowed: boolean, reason?: string};
  createdAt: Date;
  updatedAt: Date;
}

// Actual Schema

const BusinessSchema: Schema = new Schema({
  userId: {
    type: String,
    required: true,
    index: true,
  },
  userEmail: {
    type: String,
    required: true,
    index: true,
  },
  isActive: {
    type: Boolean,
    default: true,
    index: true,
  },
  freezeInfo: {
    isFrozen: {
      type: Boolean,
      default: false,
      index: true,
    },
    reason: {
      type: String,
      enum: ['trial_expired', 'payment_failed', 'admin_action', 'subscription_canceled', 'user_requested'],
    },
    frozenAt: Date,
    frozenBy: {
      type: String,
      enum: ['system' , 'admin'],
    },
    adminNote: {
      type: String,
      maxlength: 500,
    },
    autoUnfreezeAt: Date,
  },
  basicInfo: {
    businessName: {
      type: String,
      required: true,
      maxlength: 100,
      trim: true,
    },
    businessDescription: {
      type: String,
      required: true,
      maxlength: 500,
    },
    businessType: {
      type: String,
      required: true,
      maxlength: 100,
      trim: true
    },
    operatingHours: {
      type: String,
      required: true
    },
    location: {
      type: String,
      required: true
    },
    timezone: String
  },
  productsServices: {
    offerings: {
      type: String,
      required: true,
      maxlength: 1000
    },
    popularItems: [{
      name: String,
      description: String,
      price: Number
    }],
    serviceDelivery: [{
      type: String,
      enum: ['Delivery', 'Pickup', 'In-person', 'Online/Virtual'], 
    }],
    pricingDisplay : {
      canDiscussPricing: {
        type: Boolean,
        default: true 
      },
      pricingNote: String
    }
  },
  customerSupport: {
    faqs: [{
      question: String,
      answer: String,
    }],
    policies: {
      refundPolicy: {
        type: String,
        required: true 
      },
      cancellationPolicy: String,
      importantPolicies: String 
    },
    chatbotTone: {
      type: String,
      enum: ['Friendly', 'Professional', 'Casual', 'Formal', 'Playful'],
      default: 'Friendly'
    },
    chatbotGreeting: String,
    chatbotRestrictions: String
  },
  contactEscalation: {
    contactMethods: [{
      method: {
        type: String,
        enum: ['Email', 'Phone', 'WhatsApp', 'Live Chat', 'Social Media']
      },
      value: String
    }],
    escalationContact: {
      name: {
        type: String,
        required: true
      },
      email: {
        type: String,
        required: true 
      },
      phone: String 
    },
    chatbotCapabilities: [{
      type: String,
      enum: ['Answer FAQs', 'Book appointments', 'Generate leads', 'Handle Complaints', 'Provide product info',
        'Process orders'
      ]
    }]
  },
  files: {
    documents: [{
      fileName: String,
      fileUrl: String, // Cloud storage URL
      uploadDate: {
        type: Date,
        default: Date.now
      },
      fileSize: Number 
    }],
    images: [{
      fileName: String,
      fileUrl: String, // Cloud storage URL
      uploadDate: {
        type: Date,
        default: Date.now 
      },
      category: {
        type: String,
        enum: ['Logo', 'Product', 'StoreFront', 'Team', 'Other']
      }
    }]
  },

  // Vector DB tracking

  vectorInfo: {
    namespace: String,
    lastVectorUpdate: {
      type: Date,
      default: Date.now 
    },
    vectorStatus: {
      type: String,
      enum: ['pending', 'completed', 'failed', 'frozen'],
      default: 'pending'
    },
    needsUpdate: {
      type: Boolean,
      default: false
    }, 
    vectorCount: {
      type: Number,
      default: 0,
    },
    lastSyncAttempt: Date,
    processingErrors: {         
      lastError: String,
      lastErrorAt: Date,
    }
  }
}, {
  timestamps: true
});

BusinessSchema.pre('save', function(this: IBusinessDocument, next) {
  // Set namespace on creation
  if (this.isNew) {
    this.vectorInfo.namespace = `business_${this._id}`;
  }

  // Sync freezeInfo isFrozen with isActive
  if (this.isModified('isActive')) {
    if (!this.isActive && !this.freezeInfo?.isFrozen) {
      // Business deactivated - auto populate freezeInfo
      this.freezeInfo = {
        isFrozen: true,
        reason: this.freezeInfo?.reason || 'admin_action',
        frozenAt: new Date(),
        frozenBy: this.freezeInfo?.frozenBy || 'system',
      };
    } else if (this.isActive && this.freezeInfo?.isFrozen) {
      this.freezeInfo.isFrozen = false;
    }
  }

  //Update vector status when frozen/unfrozen

  if (this.isModified('isActive') || this.isModified('freezeInfo.isFrozen')) {
    if (!this.isActive || this.freezeInfo?.isFrozen) {
      this.vectorInfo.vectorStatus = 'frozen';
    } else if (this.vectorInfo.vectorStatus === 'frozen') {
      // Restore previous status or set to pending for re-sync
      this.vectorInfo.vectorStatus = 'pending';
      this.vectorInfo.needsUpdate = true;
    }
  }

  next()
});


// Instance method: Check if business can be used for chat
BusinessSchema.methods.canChat = function(this: IBusiness): { allowed: boolean; reason?: string } {
  if (!this.isActive) {
    return { 
      allowed: false, 
      reason: this.freezeInfo?.reason 
        ? `Business frozen: ${this.freezeInfo.reason.replace(/_/g, ' ')}`
        : 'Business is inactive'
    };
  }
  
  if (this.freezeInfo?.isFrozen) {
    return { 
      allowed: false, 
      reason: this.freezeInfo.reason 
        ? `Service unavailable: ${this.freezeInfo.reason.replace(/_/g, ' ')}`
        : 'Business is temporarily frozen'
    };
  }
  
  if (this.vectorInfo.vectorStatus === 'frozen' || this.vectorInfo.vectorStatus === 'failed') {
    return { 
      allowed: false, 
      reason: 'Chatbot setup incomplete. Please contact support.'
    };
  }
  
  return { allowed: true };
};

// Static method: Find businesses needing freeze (for cron jobs)
BusinessSchema.statics.findBusinessesNeedingFreeze = function() {
  // This will be used by your cron job
  // Example: find trials that expired
  return this.find({
    isActive: true,
    'freezeInfo.isFrozen': { $ne: true },
    // Add your trial expiration logic here
  });
};

export interface IBusinessModel extends Model<IBusinessDocument> {
  findBusinessesNeedingFreeze(): Promise<IBusinessDocument[]>;
}

export type IBusiness = IBusinessDocument;

export default mongoose.model<IBusinessDocument, IBusinessModel>('Business', BusinessSchema);