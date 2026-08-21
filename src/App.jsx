import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import Home from "./Home.jsx";
import NavBar from "./NavBar.jsx";
import Table from "./table-scaffold.jsx";

function App() {
  return (
    <BrowserRouter>
      <NavBar />
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/table" element={<Table />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
