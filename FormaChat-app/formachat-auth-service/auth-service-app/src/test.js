// test-rabbitmq.js
const amqp = require('amqplib');

// Option 1: Hardcode the URL for testing
const RABBITMQ_URL = "amqps://wjjqrkpb:lS1RsCC0GILSjP-jbHeo2B8J1gIVSvMG@leopard.lmq.cloudamqp.com/wjjqrkpb";

// Option 2: Load from .env file (uncomment if using this)
// require('dotenv').config();
// const RABBITMQ_URL = process.env.RABBITMQ_URL;

async function testConnection() {
  console.log('Testing RabbitMQ connection...');
  console.log('URL:', RABBITMQ_URL.replace(/:[^:@]+@/, ':***@')); // Mask password
  
  try {
    console.log('\n1. Connecting to RabbitMQ...');
    const connection = await amqp.connect(RABBITMQ_URL);
    console.log('✅ RabbitMQ connected successfully');
    
    console.log('\n2. Creating channel...');
    const channel = await connection.createChannel();
    console.log('✅ Channel created successfully');
    
    console.log('\n3. Testing channel operations...');
    
    // Test exchange assertion
    await channel.assertExchange('test.exchange', 'topic', { durable: true });
    console.log('✅ Exchange assertion successful');
    
    // Test queue assertion
    await channel.assertQueue('test.queue', { durable: true });
    console.log('✅ Queue assertion successful');
    
    // Test publishing
    const testMessage = { test: 'message', timestamp: Date.now() };
    channel.publish(
      'test.exchange',
      'test.routing.key',
      Buffer.from(JSON.stringify(testMessage)),
      { persistent: true }
    );
    console.log('✅ Message published successfully');
    
    console.log('\n4. Cleaning up...');
    await channel.deleteQueue('test.queue');
    await channel.deleteExchange('test.exchange');
    await channel.close();
    await connection.close();
    console.log('✅ Cleanup completed');
    
    console.log('\n✅ ALL TESTS PASSED - RabbitMQ is working correctly!');
    process.exit(0);
    
  } catch (error) {
    console.error('\n❌ RabbitMQ connection failed:');
    console.error('Error message:', error.message);
    console.error('Error code:', error.code);
    console.error('Full error:', error);
    
    // Common error explanations
    if (error.code === 'ENOTFOUND') {
      console.error('\n💡 DNS resolution failed - check your internet connection');
    } else if (error.code === 'ECONNREFUSED') {
      console.error('\n💡 Connection refused - RabbitMQ server might be down');
    } else if (error.code === 'ETIMEDOUT') {
      console.error('\n💡 Connection timed out - check firewall/network settings');
    } else if (error.message.includes('ACCESS_REFUSED')) {
      console.error('\n💡 Authentication failed - check your credentials');
    }
    
    process.exit(1);
  }
}

// Add connection timeout
const timeout = setTimeout(() => {
  console.error('\n❌ Connection timeout after 30 seconds');
  process.exit(1);
}, 30000);

testConnection().then(() => {
  clearTimeout(timeout);
}).catch((error) => {
  clearTimeout(timeout);
  console.error('Unexpected error:', error);
  process.exit(1);
});