import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import Contribute from "./Contribute.jsx";
import Home from "./Home.jsx";
import NavBar from "./NavBar.jsx";
import Table from "./table-scaffold.jsx";

const basename = import.meta.env.BASE_URL.replace(/\/$/, "") || "/";

function App() {
  return (
    <BrowserRouter basename={basename}>
      <NavBar />
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/table" element={<Table />} />
        <Route path="/contribute" element={<Contribute />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
