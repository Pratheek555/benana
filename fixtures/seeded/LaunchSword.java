package dev.benana.mod;

import java.util.HashMap;
import java.util.Map;
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

public final class LaunchSword extends JavaPlugin implements Listener {
    private static final long COOLDOWN_MS = 3000;
    private final Map<UUID, Long> lastLaunch = new HashMap<>();

    @Override
    public void onEnable() {
        getServer().getPluginManager().registerEvents(this, this);
        getLogger().info("LaunchSword enabled");
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

        target.setVelocity(new Vector(0, 1.6, 0));
        target.getWorld().spawnParticle(Particle.CLOUD, target.getLocation(), 30, 0.3, 0.2, 0.3, 0.05);
        target.getWorld().playSound(target.getLocation(), Sound.ENTITY_FIREWORK_ROCKET_LAUNCH, 1f, 1f);
        getLogger().info("Launched " + target.getType() + " for " + player.getName());
    }
}
