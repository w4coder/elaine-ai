import { useEffect, useState } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { api } from "./lib/api";
import { notificationStore } from "./lib/notification-store";
import type { UserProfile } from "./lib/types";
import { ModelsPage } from "./pages/ModelsPage";
import { ChatPage } from "./pages/ChatPage";
import { ProfilePage } from "./pages/ProfilePage";
import { MemoryPage } from "./pages/MemoryPage";
import { SchedulesPage } from "./pages/SchedulesPage";
import { SettingsPage } from "./pages/SettingsPage";
import { NotificationsPage } from "./pages/NotificationsPage";
import { ConnectionsPage } from "./pages/ConnectionsPage";

export default function App() {
  // undefined = loading, null = not set, UserProfile = complete
  const [userProfile, setUserProfile] = useState<UserProfile | null | undefined>(undefined);

  useEffect(() => {
    api
      .getUserProfile()
      .then(setUserProfile)
      .catch(() => setUserProfile(null));
  }, []);

  useEffect(() => {
    void notificationStore.init();
    const unsubscribe = api.subscribeNotificationEvents({
      onNotificationCreated({ notification }) {
        notificationStore.addFromServer(notification);
      },
    });
    return unsubscribe;
  }, []);

  // Still loading — render nothing to avoid flash
  if (userProfile === undefined) {
    return null;
  }

  return (
    <Routes>
      <Route
        path="/profile"
        element={
          <ProfilePage
            isFirstTime={userProfile === null}
            existingProfile={userProfile}
            onComplete={(profile) => setUserProfile(profile)}
          />
        }
      />
      <Route path="/memory" element={<MemoryPage />} />
      <Route path="/schedules" element={<SchedulesPage />} />
      <Route path="/models" element={<ModelsPage />} />
      <Route path="/settings" element={<SettingsPage />} />
      <Route path="/notifications" element={<NotificationsPage />} />
      <Route path="/notifications/:id" element={<NotificationsPage />} />
      <Route path="/channels" element={<ConnectionsPage />} />
      <Route
        path="/"
        element={userProfile === null ? <Navigate to="/profile" replace /> : <ChatPage />}
      />
      <Route
        path="/c/:id"
        element={userProfile === null ? <Navigate to="/profile" replace /> : <ChatPage />}
      />
    </Routes>
  );
}
