import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import Analytics from "./Analytics.jsx";
import Contribute from "./Contribute.jsx";
import Home from "./Home.jsx";
import NavBar from "./NavBar.jsx";
import Subscribe from "./Subscribe.jsx";
import Table from "./table-scaffold.jsx";

const basename = import.meta.env.BASE_URL.replace(/\/$/, "") || "/";

function App() {
  return (
    <BrowserRouter basename={basename}>
      <Analytics />
      <NavBar />
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/table" element={<Table />} />
        <Route path="/contribute" element={<Contribute />} />
        <Route path="/subscribe" element={<Subscribe />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
