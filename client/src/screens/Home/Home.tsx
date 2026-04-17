import HomeContext from "./context";
import useHome from "./useHome";
import Board from "./components/Board";
import ConflictResolver from "./components/ConflictResolver";

const HomeComp = () => {
    return (
        <>
            <Board />
            <ConflictResolver />
        </>
    );
};

const Home = () => {
    const value = useHome();
    return (
        <HomeContext.Provider value={value}>
            <HomeComp />
        </HomeContext.Provider>
    );
};

export default Home;
