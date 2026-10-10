package dev.benana.launchsword;

import java.util.HashMap;
import java.util.Map;
import java.util.Properties;
import java.util.UUID;
import org.bukkit.Material;
import org.bukkit.Particle;
import org.bukkit.Sound;
import org.bukkit.entity.LivingEntity;
import org.bukkit.entity.Player;
import org.bukkit.event.EventHandler;
import org.bukkit.event.Listener;
import org.bukkit.event.entity.EntityDamageByEntityEvent;
import org.bukkit.plugin.java.JavaPlugin;
import org.bukkit.util.Vector;

// Fixture for the playtester: a golden sword launches the mob it hits, with a 3 second cooldown.
// Built with -Dbugged=true it sets the velocity inside the damage event, where vanilla knockback
// overwrites it on the same tick, so the mob barely leaves the ground.
public final class LaunchSword extends JavaPlugin implements Listener {
    private static final long COOLDOWN_MS = 3000;
    private final Map<UUID, Long> lastLaunch = new HashMap<>();
    private boolean bugged;

    @Override
    public void onEnable() {
        Properties props = new Properties();
        try (var in = getResource("fixture.properties")) {
            if (in != null) props.load(in);
        } catch (Exception ignored) {
        }
        bugged = Boolean.parseBoolean(props.getProperty("bugged", "false"));
        getServer().getPluginManager().registerEvents(this, this);
        getLogger().info("LaunchSword ready" + (bugged ? " (bugged fixture)" : ""));
    }

    @EventHandler
    public void onHit(EntityDamageByEntityEvent event) {
        if (!(event.getDamager() instanceof Player player)) return;
        if (!(event.getEntity() instanceof LivingEntity target)) return;
        if (player.getInventory().getItemInMainHand().getType() != Material.GOLDEN_SWORD) return;

        long now = System.currentTimeMillis();
        Long last = lastLaunch.get(player.getUniqueId());
        if (last != null && now - last < COOLDOWN_MS) return;
        lastLaunch.put(player.getUniqueId(), now);

        Vector launch = new Vector(0, 1.6, 0);
        if (bugged) {
            target.setVelocity(launch);
        } else {
            getServer().getScheduler().runTask(this, () -> target.setVelocity(launch));
        }
        target.getWorld().spawnParticle(Particle.CLOUD, target.getLocation(), 30, 0.3, 0.2, 0.3, 0.05);
        target.getWorld().playSound(target.getLocation(), Sound.ENTITY_FIREWORK_ROCKET_LAUNCH, 1f, 1f);
    }
}
