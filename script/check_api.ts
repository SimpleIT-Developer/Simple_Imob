
import axios from 'axios';

async function checkApi() {
  try {
    // Assuming default port 5000, or checking vite config. 
    // In this environment, often the backend runs on 5000.
    const response = await axios.get('http://localhost:5000/api/tenants', {
       headers: {
         // Need authentication. 
         // I can't easily authenticate via script without login.
         // But I can try to login first.
         'Content-Type': 'application/json'
       }
    });
    console.log(response.data);
  } catch (error) {
    console.error("Error fetching API:", error.message);
    if (error.response) {
      console.error("Status:", error.response.status);
    }
  }
}

// checkApi(); 
// This is hard because of auth.
