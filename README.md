**SMSphere - Enchanting Group Chats via SMPP Protocol with Node.js**
SMSphere is an enchanting group chat platform that leverages the power of the SMPP (Short Message Peer-to-Peer) protocol and Node.js backend. It enables users to engage in seamless and delightful group conversations through SMS messaging.


I created this project as a concept idea and will try to build upon it more and more as time goes by.

**Features**

**Create Group:** Create a group with a unique shortcode and send welcome SMS to all group members.
**Add User:** Add a user to an existing group, sending notifications to all group members and a separate welcome SMS to the new user.
**Send Message to All Members:** Broadcast messages to all group members.
**Receive Inbound Messages:** Validate inbound SMS messages, manipulate and forward them to group members, and process special keywords or commands.
**Chat History:** Save and display chat history for a specific shortcode, including sender address and timestamp.

**Future Plans**

**Remove User from the Group:** Allow users to opt-out using SMS or enable group owners to remove members.
Enhanced User Profile: Create a separate database collection for basic user information and the groups they are part of.
Improved Command Functionality: Implement additional functionality based on specific keywords or commands.
**Getting Started**
To get started with SMSphere, follow these steps:

Clone the repository:
```
Install dependencies:

Copy
npm install
```
Configure database settings and SMPP protocol parameters in the configuration file.
Run the application:

Copy
npm start
```
Access the application at http://localhost:3000 and start creating and joining groups.

**Contributing**
We welcome contributions to enhance SMSphere! To contribute:


This project is licensed under the MIT License.

Feel free to explore and contribute to SMSphere. Join us in creating an enchanting group chat experience via SMS!
