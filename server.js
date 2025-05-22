// This code sets up an Express server that handles file uploads and image prediction 
// using an external API. Each line is commented to clearly explain its purpose,
// making it accessible for younger audiences or beginners.
import path from "path"; // Import the module for handling file and directory paths
import { fileURLToPath } from "url"; // Import a function to convert URL to file path
import dotenv from 'dotenv'; // Import the library to manage environment variables
import express from 'express'; // Import the Express framework for building web applications
import axios from 'axios'; // Import the library for making HTTP requests
import bodyParser from 'body-parser'; // Import the library to parse request bodies
import cors from 'cors'; // Import the library to handle CORS (Cross-Origin Resource Sharing)
import fs from 'fs'; // Import the library for file system operations
import multer from 'multer'; // Import the library for handling file uploads
import winston from 'winston'; // Import the library for logging

dotenv.config(); // Load environment variables from a .env file

// Get the current file's path
const __filename = fileURLToPath(import.meta.url);
// Get the current directory's path
const __dirname = path.dirname(__filename);
const app = express(); // Create an Express application
const PORT = process.env.PORT || 3002; // Get the port number from environment variables, or use 3002

// Create a logger
const logger = winston.createLogger({
    level: 'info', // Set the log level to 'info'
    format: winston.format.combine(
        winston.format.timestamp(), // Add a timestamp to each log entry
        winston.format.json() // Format logs as JSON
    ),
    transports: [
        new winston.transports.File({ filename: 'combined.log' }), // Save logs to a file called 'combined.log'
        new winston.transports.Console() // Also print logs to the console
    ],
});

// CORS configuration
app.use(cors({
    origin: 'http://localhost:5173' // Allow requests from this frontend URL
}));
app.use(bodyParser.json()); // Parse incoming request bodies as JSON

// Configure multer for file uploads
const storage = multer.diskStorage({
    // Set the destination for uploaded files
    destination: (req, file, cb) => {
        cb(null, path.join(__dirname, 'uploads')); // Save files in the 'uploads' folder
    },
    // Set the filename for the uploaded files
    filename: (req, file, cb) => {
        cb(null, file.originalname); // Use the original file name
    }
});
const upload = multer({ storage }); // Initialize multer with the storage configuration

// Upload endpoint
app.post('/upload', upload.single('file'), (req, res) => {
    // Check if a file was uploaded
    if (!req.file) {
        return res.status(400).send('No file uploaded.'); // Send an error message if no file
    }
    logger.info(`File uploaded: ${req.file.originalname}`); // Log the uploaded file name
    res.json({ images: [{ image: req.file.filename }] }); // Send back the uploaded file name as JSON
});

// Prediction endpoint
app.post('/predict', async (req, res) => {
    const { images } = req.body; // Get the images from the request body
    logger.info(`Received images for prediction: ${JSON.stringify(images)}`); // Log the received images

    // Check if images is an array
    if (!Array.isArray(images)) {
        logger.warn("Invalid input format. 'images' should be an array."); // Log a warning
        return res.status(400).json({ error: "Invalid input format. 'images' should be an array." }); // Send an error message
    }

    const results = []; // Create an array to store results

    // Process each image one by one
    for (const image of images) {
        try {
            const imageFilePath = path.join(__dirname, 'uploads', image.image); // Create the file path for the image
            logger.info(`Processing image: ${imageFilePath}`); // Log the image being processed

            // Check if the image file exists
            if (!fs.existsSync(imageFilePath)) {
                logger.error(`Image file does not exist: ${imageFilePath}`); // Log an error
                results.push({ path: image.image, error: 'Image file does not exist' }); // Add error to results
                continue; // Move to the next image
            }

            const imageFile = fs.readFileSync(imageFilePath); // Read the image file
            const response = await axios.post(process.env.AZURE_CUSTOM_VISION_ENDPOINT,
                imageFile,
                {
                    headers: {
                        'Prediction-Key': process.env.AZURE_CUSTOM_VISION_PREDICTION_KEY, // Use the prediction key for authentication
                        'Content-Type': 'application/octet-stream' // Set the content type
                    }
                }
            );

            // Organize the prediction results
            const predictions = response.data.predictions.map(prediction => ({
                tagName: prediction.tagName, // Get the tag name
                probability: (prediction.probability * 100).toFixed(2) // Convert probability to percentage
            }));

            results.push({ path: image.image, predictions }); // Add predictions to the results
            logger.info(`Prediction successful for image: ${image.image}`); // Log success
        } catch (error) {
            logger.error(`Error processing ${image.image}: ${error.message}`); // Log an error
            if (error.response) {
                logger.error(`Response data: ${JSON.stringify(error.response.data)}`); // Log response data from Azure
                if (error.response.data.error) {
                    logger.error(`Error Code: ${error.response.data.error.code}`); // Log the error code
                    logger.error(`Error Message: ${error.response.data.error.message}`); // Log the error message
                }
            } else {
                logger.error('No response data available.'); // Log if no response data
            }
            results.push({ path: image.image, error: 'Prediction failed' }); // Add error to results
        }
    }

    res.json(results); // Send back the results as JSON
});

// Serve uploaded images
app.use('/uploads', express.static(path.join(__dirname, 'uploads'))); // Serve static files from the 'uploads' folder

// Start the server
app.listen(PORT, () => {
    logger.info(`Server is running on http://localhost:${PORT}`); // Log that the server is running
});
