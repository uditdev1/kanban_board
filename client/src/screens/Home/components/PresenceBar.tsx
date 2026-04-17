import { useContext } from "react";
import HomeContext from "../context";

function PresenceBar() {
    const { users, currentUser } = useContext(HomeContext);

    // Filter out current user from display
    const otherUsers = users.filter(
        (u: any) => currentUser && u.username !== currentUser.username
    );

    return (
        <div className="presence-bar">
            <div className="presence-label">
                <span className="presence-icon">👥</span>
                <span>{users.length} online</span>
            </div>
            <div className="presence-avatars">
                {/* Current user */}
                {currentUser && (
                    <div
                        className="presence-avatar you"
                        style={{ backgroundColor: currentUser.color }}
                        title={`${currentUser.username} (you)`}
                    >
                        {currentUser.username.charAt(0).toUpperCase()}
                    </div>
                )}
                {/* Other users */}
                {otherUsers.map((user: any) => (
                    <div
                        key={user.id}
                        className="presence-avatar"
                        style={{ backgroundColor: user.color }}
                        title={user.username}
                    >
                        {user.username.charAt(0).toUpperCase()}
                    </div>
                ))}
            </div>
        </div>
    );
}

export default PresenceBar;
