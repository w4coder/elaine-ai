import {
  Bell,
  Calendar,
  Link2,
  MessageSquarePlus,
  MoreHorizontal,
  PanelLeft,
  Search,
  Settings2,
  ChevronUp,
  Pencil,
  Trash2,
  Brain,
  User,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { ConversationSummary } from "../lib/types";
import { notificationStore } from "../lib/notification-store";
import { AppLogo } from "./AppLogo";

interface SidebarProps {
  open: boolean;
  onToggle(): void;
  conversations: ConversationSummary[];
  activeId: string | null;
  search: string;
  userName: string | null;
  onSearchChange(value: string): void;
  onNewConversation(): void;
  onNewSchedule(): void;
  onSelectConversation(id: string): void;
  onRenameConversation(id: string, title: string): void;
  onDeleteConversation(id: string): void;
}

export function Sidebar(props: SidebarProps) {
  const navigate = useNavigate();
  const [profileMenuOpen, setProfileMenuOpen] = useState(false);
  const [searchFocused, setSearchFocused] = useState(false);
  const [openConversationMenuId, setOpenConversationMenuId] = useState<string | null>(null);
  const conversationMenuRef = useRef<HTMLLIElement | null>(null);
  const [unreadCount, setUnreadCount] = useState(() => notificationStore.unreadCount());

  useEffect(() => {
    return notificationStore.subscribe((items) =>
      setUnreadCount(items.filter((n) => !n.read).length)
    );
  }, []);

  useEffect(() => {
    function handlePointerDown(event: MouseEvent) {
      if (!conversationMenuRef.current?.contains(event.target as Node)) {
        setOpenConversationMenuId(null);
      }
    }

    function handleEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpenConversationMenuId(null);
      }
    }

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleEscape);
    };
  }, []);

  return (
    <aside className={`sidebar${props.open ? "" : " sidebar--hidden"} text-lg`}>
      {/* Top bar: logo + close button */}
      <div className="sidebar__topbar">
        <div className="sidebar__logo">
          <AppLogo size={22} />
          <span className="sidebar__logo-wordmark">Elaine</span>
        </div>
        <button
          className="sidebar__toggle-btn"
          type="button"
          onClick={props.onToggle}
          aria-label="Close sidebar"
        >
          <PanelLeft size={20} />
        </button>
      </div>

      {/* Nav actions */}
      <div className="sidebar__nav">
        <button className="sidebar__nav-item" type="button" onClick={props.onNewConversation}>
          <span className="sidebar__nav-icon">
            <div className="sidebar__new-icon">
              <MessageSquarePlus size={15} />
            </div>
          </span>
          <span className="sidebar__nav-label">New conversation</span>
        </button>

        <button className="sidebar__nav-item" type="button" onClick={props.onNewSchedule}>
          <span className="sidebar__nav-icon">
            <div className="sidebar__new-icon">
              <Calendar size={15} />
            </div>
          </span>
          <span className="sidebar__nav-label">Schedule</span>
        </button>

        <label
          className={`sidebar__nav-item sidebar__nav-item--search ${searchFocused ? "sidebar__nav-item--focused" : ""}`}
        >
          <span className="sidebar__nav-icon">
            <Search size={15} />
          </span>
          <input
            className="sidebar__search-input"
            value={props.search}
            onChange={(event) => props.onSearchChange(event.target.value)}
            placeholder="Search"
            onFocus={() => setSearchFocused(true)}
            onBlur={() => setSearchFocused(false)}
          />
        </label>
      </div>

      {/* Conversations list */}
      <div className="sidebar__conversations">
        {props.conversations.length > 0 && <div className="sidebar__section-label">Récents</div>}
        <ul className="sidebar__list">
          {props.conversations.map((conversation) => {
            const isActive = conversation.id === props.activeId;
            return (
              <li
                key={conversation.id}
                className="sidebar__item-wrapper"
                ref={openConversationMenuId === conversation.id ? conversationMenuRef : null}
              >
                <button
                  className={`sidebar__item${isActive ? " sidebar__item--active" : ""}`}
                  type="button"
                  onClick={() => {
                    props?.onToggle();
                    props.onSelectConversation(conversation.id);
                  }}
                >
                  <span className="sidebar__item-title">{conversation.title}</span>
                </button>
                <button
                  className="sidebar__item-options"
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setOpenConversationMenuId((current) =>
                      current === conversation.id ? null : conversation.id
                    );
                  }}
                  aria-label={`Options for ${conversation.title}`}
                  aria-expanded={openConversationMenuId === conversation.id}
                >
                  <MoreHorizontal size={16} />
                </button>
                {openConversationMenuId === conversation.id && (
                  <div
                    className="sidebar__item-menu"
                    role="menu"
                    aria-label={`Actions for ${conversation.title}`}
                  >
                    <button
                      className="sidebar__item-menu-option"
                      type="button"
                      role="menuitem"
                      onClick={() => {
                        setOpenConversationMenuId(null);
                        props.onRenameConversation(conversation.id, conversation.title);
                      }}
                    >
                      <Pencil size={14} />
                      <span>Rename</span>
                    </button>
                    <button
                      className="sidebar__item-menu-option sidebar__item-menu-option--danger"
                      type="button"
                      role="menuitem"
                      onClick={() => {
                        setOpenConversationMenuId(null);
                        props.onDeleteConversation(conversation.id);
                      }}
                    >
                      <Trash2 size={14} />
                      <span>Delete</span>
                    </button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      </div>

      {/* User profile footer */}
      <div className="sidebar__footer">
        {profileMenuOpen && (
          <div className="sidebar__profile-menu">
            <button
              className="sidebar__profile-menu-item"
              type="button"
              onClick={() => {
                setProfileMenuOpen(false);
                navigate("/memory");
              }}
            >
              <Brain size={15} />
              <span>Memory</span>
            </button>
            <button
              className="sidebar__profile-menu-item"
              type="button"
              onClick={() => {
                setProfileMenuOpen(false);
                navigate("/schedules");
              }}
            >
              <Calendar size={15} />
              <span>Schedules</span>
            </button>
            <button
              className="sidebar__profile-menu-item"
              type="button"
              onClick={() => {
                setProfileMenuOpen(false);
                navigate("/notifications");
              }}
            >
              <Bell size={15} />
              <span>Notifications</span>
              {unreadCount > 0 && (
                <span
                  className="ml-auto min-w-[18px] h-[18px] px-1 rounded-full text-[10px] font-semibold flex items-center justify-center"
                  style={{ background: "var(--accent)", color: "#fff" }}
                >
                  {unreadCount > 99 ? "99+" : unreadCount}
                </span>
              )}
            </button>
            <button
              className="sidebar__profile-menu-item"
              type="button"
              onClick={() => {
                setProfileMenuOpen(false);
                navigate("/channels");
              }}
            >
              <Link2 size={15} />
              <span>Connections</span>
            </button>
            <button
              className="sidebar__profile-menu-item"
              type="button"
              onClick={() => {
                setProfileMenuOpen(false);
                navigate("/profile");
              }}
            >
              <User size={15} />
              <span>My profile</span>
            </button>
            <button
              className="sidebar__profile-menu-item"
              type="button"
              onClick={() => {
                setProfileMenuOpen(false);
                navigate("/settings");
              }}
            >
              <Settings2 size={15} />
              <span>Settings</span>
            </button>
          </div>
        )}
        <button
          className="sidebar__profile"
          type="button"
          onClick={() => setProfileMenuOpen((o) => !o)}
          aria-label="User menu"
        >
          <div className="sidebar__profile-avatar">
            {props.userName ? props.userName[0].toUpperCase() : "E"}
          </div>
          <div className="sidebar__profile-info">
            <span className="sidebar__profile-name">{props.userName ?? "Elaine"}</span>
            <span className="sidebar__profile-sub">Local build</span>
          </div>
          <ChevronUp
            size={15}
            className={`sidebar__profile-chevron${profileMenuOpen ? " sidebar__profile-chevron--open" : ""}`}
          />
        </button>
      </div>
    </aside>
  );
}
