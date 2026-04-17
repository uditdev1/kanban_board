import { Toaster } from "react-hot-toast";
import Home from "./screens/Home/Home";
import "./index.css";

function App() {
    return (
        <>
            <Home />
            <Toaster
                position="bottom-right"
                toastOptions={{
                    style: {
                        background: "#1e1b2e",
                        color: "#e2e0f0",
                        border: "1px solid rgba(255,255,255,0.1)",
                    },
                }}
            />
        </>
    );
}

export default App;
